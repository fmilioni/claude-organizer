import { reactive } from 'vue'

import type { DiffFileSignature } from '~/utils/diffFiles'

// Per-browser "viewed" state for diff files (no backend; works auth on or off).
// Bounded on two axes so localStorage can't grow without limit: at most
// MAX_CARDS cards are kept (LRU by last touch), and a file entry only counts as
// viewed while its stored hash matches the current diff (a changed file drops to
// unviewed and reconcile() prunes the dead entry).
const STORAGE_KEY = 'co:diff-viewed'
const MAX_CARDS = 40

interface CardEntry {
  t: number
  files: Record<string, string>
}
interface Store {
  cards: Record<string, CardEntry>
}

const fileKey = (sha: string, path: string) => `${sha}\n${path}`

// Rebuild a record dropping keys matching `drop` — Object spread avoids the
// dynamic `delete` the linter forbids and keeps the reactive ref clean.
function without(
  rec: Record<string, string>,
  drop: (key: string) => boolean
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const k of Object.keys(rec)) if (!drop(k)) next[k] = rec[k]!
  return next
}

const state = reactive<Store>({ cards: {} })
let loaded = false

function load() {
  if (loaded || !import.meta.client) return
  loaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Store
      if (parsed && typeof parsed === 'object' && parsed.cards) {
        state.cards = parsed.cards
      }
    }
  } catch {
    // Corrupt/unavailable storage — start empty rather than break the page.
  }
}

function persist() {
  if (!import.meta.client) return
  const ids = Object.keys(state.cards)
  if (ids.length > MAX_CARDS) {
    const keep = ids
      .sort((a, b) => (state.cards[a]!.t) - (state.cards[b]!.t))
      .slice(ids.length - MAX_CARDS)
    const next: Record<string, CardEntry> = {}
    for (const id of keep) next[id] = state.cards[id]!
    state.cards = next
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Quota or disabled storage — keep the in-memory state, just don't persist.
  }
}

function touch(cardId: string): CardEntry {
  const entry = state.cards[cardId] ?? { t: 0, files: {} }
  entry.t = import.meta.client ? Date.now() : 0
  state.cards[cardId] = entry
  return entry
}

export function useViewedFiles() {
  load()

  function isViewed(cardId: string, sha: string, path: string, hash: string) {
    return state.cards[cardId]?.files[fileKey(sha, path)] === hash
  }

  function setViewed(
    cardId: string,
    sha: string,
    path: string,
    hash: string,
    viewed: boolean
  ) {
    const entry = touch(cardId)
    const key = fileKey(sha, path)
    if (viewed) entry.files[key] = hash
    else entry.files = without(entry.files, k => k === key)
    persist()
  }

  function countViewed(cardId: string, sha: string, sigs: DiffFileSignature[]) {
    return sigs.reduce(
      (n, s) => n + (isViewed(cardId, sha, s.path, s.hash) ? 1 : 0),
      0
    )
  }

  // Drop entries for this commit whose file no longer exists in the diff or whose
  // content changed — keeps a card's stored set from accumulating dead files.
  function reconcile(cardId: string, sha: string, sigs: DiffFileSignature[]) {
    const entry = state.cards[cardId]
    if (!entry) return
    const live = new Map(sigs.map(s => [s.path, s.hash]))
    const stale = (key: string) =>
      key.startsWith(`${sha}\n`)
      && live.get(key.slice(sha.length + 1)) !== entry.files[key]
    if (Object.keys(entry.files).some(stale)) {
      entry.files = without(entry.files, stale)
      persist()
    }
  }

  return { isViewed, setViewed, countViewed, reconcile }
}
