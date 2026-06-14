export interface DiffFileSignature {
  path: string
  hash: string
}

// FNV-1a over the file's raw diff block — a content fingerprint, not a crypto
// digest: when a file's diff changes, its hash changes, so a stored "viewed"
// flag keyed by hash auto-resets (GitHub re-marks a file unviewed when it moves).
export function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

// Splits a unified diff into one signature per file, in render order. Path is
// resolved exactly as DiffView does (the `+++ b/` line wins over the `b/` of the
// `diff --git` header) so the signatures line up with the rendered file blocks.
export function diffFileSignatures(diff: string): DiffFileSignature[] {
  const out: DiffFileSignature[] = []
  let path: string | null = null
  let buf: string[] = []
  const flush = () => {
    if (path !== null) out.push({ path, hash: hashString(buf.join('\n')) })
  }
  for (const raw of diff.replace(/\n$/, '').split('\n')) {
    if (raw.startsWith('diff --git ')) {
      flush()
      const m = raw.match(/^diff --git a\/(.+) b\/(.+)$/)
      path = m ? m[2]! : raw.slice('diff --git '.length)
      buf = [raw]
      continue
    }
    if (path === null) continue
    if (raw.startsWith('+++ b/')) path = raw.slice('+++ b/'.length)
    buf.push(raw)
  }
  flush()
  return out
}
