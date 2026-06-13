// Match on the GFM delimiter row — the only unambiguous table signal (header/body rows are just pipe text).
const TABLE_DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/

export function containsMarkdownTable(md: string): boolean {
  return md.split('\n').some(line => TABLE_DELIMITER_ROW.test(line))
}
