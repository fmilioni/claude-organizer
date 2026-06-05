#!/usr/bin/env node
// Capture a commit's diff and attach it to its card via the REST API.
//
//   node scripts/attach-commit.mjs <sha> [CO-N]
//   pnpm attach-commit <sha> [CO-N]
//
// The card key is parsed from the commit message (`feat(...): … (CO-12)`) unless
// passed explicitly. The diff goes straight from `git` to the API over HTTP — it
// never passes through an AI context (no MCP, no tokens spent reading it).
//
// Zero dependencies: standalone Node 18+ (global fetch). A Python twin lives at
// scripts/attach-commit.py for machines without Node. Keep the two in sync.
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

// `CO-12`, `ABC-7` — an uppercase prefix, a dash, digits. We prefer the last
// match on the subject line (the project convention puts the card's own key at
// the end of the subject), then fall back to the whole message.
const KEY_RE = /\b([A-Z][A-Z0-9]*-\d+)\b/g

function parseKey(message) {
  const subject = message.split('\n', 1)[0]
  const onSubject = [...subject.matchAll(KEY_RE)].map(m => m[1])
  if (onSubject.length) return onSubject[onSubject.length - 1]
  const anywhere = [...message.matchAll(KEY_RE)].map(m => m[1])
  return anywhere.length ? anywhere[0] : null
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

async function main() {
  const [shaArg, keyArg] = process.argv.slice(2)
  if (!shaArg) {
    fail('usage: attach-commit <sha> [CO-N]')
  }

  // Validate the sha and normalise it to the full hash.
  const sha = git(['rev-parse', '--verify', `${shaArg}^{commit}`]).trim()

  const message = git(['show', '-s', '--format=%B', sha]).replace(/\n+$/, '')
  const committedAt = git(['show', '-s', '--format=%cI', sha]).trim()
  const authorName = git(['show', '-s', '--format=%an', sha]).trim()

  const key = keyArg || parseKey(message)
  if (!key) {
    fail(
      `no card key found in the message of ${sha.slice(0, 8)}; pass one explicitly: attach-commit ${shaArg} CO-N`
    )
  }

  const stat = git(['show', sha, '--stat', '--format=']).replace(/^\n+/, '').replace(/\n+$/, '')
  const rawDiff = git(['show', sha, '--format=', '--patch'])
  const diff = pruneDiff(rawDiff)

  const fileCount = (rawDiff.match(/^diff --git /gm) || []).length

  const res = await fetch(`${API_URL}/cards/${encodeURIComponent(key)}/commits`, {
    method: 'POST',
    headers: withToken({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sha, message, stat, diff, committedAt, authorName })
  }).catch((err) => {
    fail(`could not reach the API at ${API_URL} (${err.message}). Is it running?`)
  })

  if (!res.ok) {
    const body = await res.text()
    fail(`API responded ${res.status}: ${body}`)
  }

  console.log(
    `✓ ${key} ${sha.slice(0, 8)} — ${fileCount} file(s), ${humanBytes(Buffer.byteLength(diff, 'utf8'))} diff → attached`
  )
}

main()
