// Sentinel sha that reuses `card_commits` (on the `(card_id, sha)` unique key)
// to carry a card's pending working-tree diff without a schema change.
export const WORKING_TREE_SHA = '__working__'

// A raster-image change in a stored diff replaces git's `Binary files … differ`
// marker with this sentinel line, carrying the captured before/after attachment
// ids so the web can render the image instead of a "binary" note. A side is
// omitted when absent (added → no `old`, deleted → no `new`). Single source of
// truth: the capture scripts build it, DiffView parses it.
export const DIFF_IMAGE_SENTINEL_PREFIX = '# image'

export interface DiffImageRefs {
  old?: string | null
  new?: string | null
}

export function buildDiffImageSentinel(refs: DiffImageRefs): string {
  const parts = [DIFF_IMAGE_SENTINEL_PREFIX]
  if (refs.old) parts.push(`old=${refs.old}`)
  if (refs.new) parts.push(`new=${refs.new}`)
  return parts.join(' ')
}

// Parses a sentinel line back to its refs, or null when the line is any other
// note. Requires at least one valid `att_` ref — a malformed or empty sentinel
// falls back to the plain binary note rather than rendering a broken image.
export function parseDiffImageSentinel(line: string): DiffImageRefs | null {
  const trimmed = line.trimEnd()
  if (
    trimmed !== DIFF_IMAGE_SENTINEL_PREFIX
    && !trimmed.startsWith(`${DIFF_IMAGE_SENTINEL_PREFIX} `)
  ) {
    return null
  }
  const refs: DiffImageRefs = {}
  for (const tok of trimmed.slice(DIFF_IMAGE_SENTINEL_PREFIX.length).trim().split(/\s+/).filter(Boolean)) {
    const m = /^(old|new)=(att_[0-9a-z]{12})$/.exec(tok)
    if (!m) return null
    if (m[1] === 'old') refs.old = m[2]
    else refs.new = m[2]
  }
  if (!refs.old && !refs.new) return null
  return refs
}
