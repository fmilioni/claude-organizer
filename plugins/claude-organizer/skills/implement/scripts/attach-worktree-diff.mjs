#!/usr/bin/env node
// Capture the working-tree (uncommitted) diff and attach it to a card via the
// REST API, so a card in review can show what will land before the commit
// exists.
//
//   node scripts/attach-worktree-diff.mjs <CO-N>
//   pnpm attach-worktree-diff <CO-N>
//
// The card key is required (there is no commit message to parse it from). The
// diff is `git diff HEAD` plus untracked files, posted under a sentinel sha so
// the backend treats it as a pending diff; the real commit (or a clean tree)
// later replaces/clears it. The diff never passes through an AI context.
//
// Zero dependencies: standalone Node 18+ (global fetch). A Python twin lives at
// scripts/attach-worktree-diff.py — keep the two in sync. The diff helpers are
// duplicated from attach-commit.mjs on purpose: each script is standalone and
// directly runnable (the .mjs/.py twins already mirror each other).
//
// Config: CO_API_URL (default http://127.0.0.1:4400).

import { execFileSync } from 'node:child_process'

const API_URL = (process.env.CO_API_URL || 'http://127.0.0.1:4400').replace(/\/$/, '')

// Card-scoped token minted by the MCP (issue_commit_token); only needed when the
// API has auth on. Absent in sem-auth mode — then no extra header is sent.
const COMMIT_TOKEN = process.env.CO_COMMIT_TOKEN

function withToken(headers = {}) {
  return COMMIT_TOKEN
    ? { ...headers, 'X-CO-Commit-Token': COMMIT_TOKEN }
    : headers
}

// Must match WORKING_TREE_SHA in @claude-organizer/shared.
const WORKING_TREE_SHA = '__working__'

// Files whose body is noise: store the header + a note instead of the patch.
const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'bun.lockb'
])
// Per-file line cap; beyond it the patch is truncated with a note.
const MAX_LINES_PER_FILE = 1000

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024
    })
  } catch (err) {
    fail(`git ${args.join(' ')} failed: ${err.message.split('\n')[0]}`)
  }
}

// `git diff --no-index` exits 1 when the inputs differ — that's the patch we
// want, on stdout, not a failure.
function gitDiffNoIndex(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024
    })
  } catch (err) {
    if (err.status === 1 && typeof err.stdout === 'string') return err.stdout
    fail(`git ${args.join(' ')} failed: ${(err.message || '').split('\n')[0]}`)
  }
}

function isIgnored(path) {
  const base = path.split('/').pop() || ''
  if (LOCKFILES.has(base)) return true
  if (/\.min\.[^.]+$/.test(base)) return true
  if (path.startsWith('dist/') || path.includes('/dist/')) return true
  return false
}

function sectionPath(lines) {
  for (const l of lines) if (l.startsWith('+++ b/')) return l.slice(6)
  for (const l of lines) if (l.startsWith('--- a/')) return l.slice(6)
  const m = lines[0].match(/^diff --git a\/(.+) b\/(.+)$/)
  return m ? m[2] : ''
}

// Split the unified patch per file and apply the safeguards.
function pruneDiff(patch) {
  if (!patch.trim()) return ''
  const sections = []
  let current = null
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) sections.push(current)
      current = [line]
    } else if (current) {
      current.push(line)
    }
  }
  if (current) sections.push(current)

  return sections
    .map((lines) => {
      const path = sectionPath(lines)
      const isBinary = lines.some(
        l => /^Binary files .* differ$/.test(l) || l.startsWith('GIT binary patch')
      )
      // Keep binary marker as-is (already a one-liner).
      if (isBinary) return lines.join('\n')
      if (isIgnored(path)) {
        return `${lines[0]}\n# diff omitted (lockfile/generated)`
      }
      if (lines.length > MAX_LINES_PER_FILE) {
        const omitted = lines.length - MAX_LINES_PER_FILE
        return (
          lines.slice(0, MAX_LINES_PER_FILE).join('\n')
          + `\n# ... (truncated: ${omitted} lines omitted)`
        )
      }
      return lines.join('\n')
    })
    .join('\n')
}

function humanBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// Summary line counted from the full pre-prune `raw` (tracked + untracked) —
// NOT the displayed (pruned) `diff` — so the badge equals the real commit's
// `git show --stat` once it lands (pruned lockfiles/binaries stay counted), and
// covers untracked files that `git diff HEAD --stat` (tracked only) would miss.
// The web parses only this last line for its file/insertion/deletion badges.
function statSummary(raw) {
  const files = (raw.match(/^diff --git /gm) || []).length
  let add = 0
  let del = 0
  for (const line of raw.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) add++
    else if (line.startsWith('-') && !line.startsWith('---')) del++
  }
  return `${files} file${files === 1 ? '' : 's'} changed, ${add} insertion${add === 1 ? '' : 's'}(+), ${del} deletion${del === 1 ? '' : 's'}(-)`
}

async function clearPending(key) {
  const res = await fetch(
    `${API_URL}/cards/${encodeURIComponent(key)}/commits/working`,
    { method: 'DELETE', headers: withToken() }
  ).catch((err) => {
    fail(`could not reach the API at ${API_URL} (${err.message}). Is it running?`)
  })
  if (!res.ok) {
    const body = await res.text()
    fail(`API responded ${res.status}: ${body}`)
  }
}

async function main() {
  const key = process.argv[2]
  if (!key) {
    fail('usage: attach-worktree-diff <CO-N>')
  }

  const tracked = git(['diff', 'HEAD'])
  // `core.quotePath=false` keeps non-ASCII / spaced paths raw so they survive
  // as literal argv to `git diff --no-index` below.
  const untracked = git([
    '-c',
    'core.quotePath=false',
    'ls-files',
    '--others',
    '--exclude-standard'
  ])
    .split('\n')
    .filter(Boolean)

  let raw = tracked
  for (const file of untracked) {
    raw += gitDiffNoIndex(['diff', '--no-index', '--', '/dev/null', file])
  }
  const diff = pruneDiff(raw)

  if (!diff.trim()) {
    await clearPending(key)
    console.log(`✓ ${key} — working tree clean, pending diff cleared`)
    return
  }

  const fileCount = (raw.match(/^diff --git /gm) || []).length
  const stat = statSummary(raw)

  const res = await fetch(
    `${API_URL}/cards/${encodeURIComponent(key)}/commits`,
    {
      method: 'POST',
      headers: withToken({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        sha: WORKING_TREE_SHA,
        message: '(uncommitted working tree)',
        stat,
        diff,
        committedAt: null,
        authorName: null
      })
    }
  ).catch((err) => {
    fail(`could not reach the API at ${API_URL} (${err.message}). Is it running?`)
  })

  if (!res.ok) {
    const body = await res.text()
    fail(`API responded ${res.status}: ${body}`)
  }

  console.log(
    `✓ ${key} working tree — ${fileCount} file(s), ${humanBytes(Buffer.byteLength(diff, 'utf8'))} diff → attached (uncommitted)`
  )
}

main()
