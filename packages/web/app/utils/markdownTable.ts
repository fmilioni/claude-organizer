// Match on the GFM delimiter row — the only unambiguous table signal (header/body rows are just pipe text).
// Two alternatives: an outer leading `|` (covers the single-column `| --- |`, which marked still renders
// as a <table>), or a no-outer-pipe row that needs an internal `|` — so a bare `---`/`- - -` rule never matches.
const TABLE_DELIMITER_ROW = /^\s*\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$|^\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/

export function containsMarkdownTable(md: string): boolean {
  return md.split('\n').some(line => TABLE_DELIMITER_ROW.test(line))
}
