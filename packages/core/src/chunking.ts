// Char-based windowing: the e5 model truncates at 512 tokens, so a long body is
// split into overlapping windows that each fit well under that limit. The core
// has no tokenizer (it lives in the embedding service), so the window is sized in
// characters — ~1500 chars ≈ 375 tokens for pt-BR/en, a safe margin below 512
// even after the `passage:` prefix. Overlap carries context across the boundary
// so a phrase split between windows is still represented in both.
const CHUNK_WINDOW = 1500
const CHUNK_OVERLAP = 200

/** Last whitespace index in `[from, to)`, or -1 — used to snap a cut to a word
 *  boundary instead of mid-token. */
function lastWhitespace(text: string, from: number, to: number): number {
  for (let i = to - 1; i >= from; i--) {
    if (/\s/.test(text[i]!)) return i
  }
  return -1
}

/**
 * Split text into overlapping windows for per-chunk embedding. Content that fits
 * one window yields exactly one chunk (the common case — no cost regression);
 * empty/whitespace-only text yields none. Cuts snap back to the last whitespace in
 * the window's tail so a word isn't split across chunks; consecutive windows
 * overlap by `overlap` chars. The snap only searches past the window's midpoint,
 * so `start` always advances and the loop terminates.
 */
export function chunkText(
  raw: string,
  window = CHUNK_WINDOW,
  overlap = CHUNK_OVERLAP
): string[] {
  const text = raw.trim()
  if (!text) return []
  if (text.length <= window) return [text]

  // Keep overlap below the window so `start` advances; the snap can still shorten
  // a window, so `start + 1` below is the final guard against a stuck cursor.
  overlap = Math.max(0, Math.min(overlap, window - 1))
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + window, text.length)
    if (end < text.length) {
      const ws = lastWhitespace(text, start + Math.floor(window / 2), end)
      if (ws > start) end = ws
    }
    const chunk = text.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= text.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks
}
