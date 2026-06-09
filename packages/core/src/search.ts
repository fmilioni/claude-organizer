import { type SQL, sql } from 'drizzle-orm'

/**
 * OR-recall tsquery from free user input: a record matching ANY positive term
 * hits, not only one matching all of them. Delegates to the `or_tsquery` SQL
 * function (migration `0021_search_or_recall`) — built on `websearch_to_tsquery`,
 * so arbitrary input never raises a syntax error. `-exclude` negations are NOT in
 * here; enforce them with `excludedTsQuery` as a NOT guard (see below).
 */
export function orTsQuery(q: string): SQL {
  return sql`or_tsquery('simple', ${q})`
}

/**
 * The `-exclude` terms of the query as a plain OR-ed tsquery (empty when there's
 * no negation). Use as `NOT (<tsv> @@ excludedTsQuery(q))` so an excluded row is
 * dropped no matter which recall branch (full-text or substring/typo) matched it.
 * An empty tsquery never matches, so the guard is a no-op without negation.
 */
export function excludedTsQuery(q: string): SQL {
  return sql`excluded_tsquery('simple', ${q})`
}

export interface FusedRank<T> {
  id: T
  score: number
}

/**
 * Reciprocal Rank Fusion: merge ranked id lists (each ordered best-first) into a
 * single ranking by summing `1 / (k + rank)` across the lists an id appears in.
 * Fuses signals on different scales (lexical ts_rank vs. cosine distance) without
 * normalizing scores — only their per-list ranks matter. `k` (default 60, the
 * canonical constant) damps the weight of top ranks. Result is sorted desc.
 */
export function reciprocalRankFusion<T>(
  lists: T[][],
  k = 60
): FusedRank<T>[] {
  const scores = new Map<T, number>()
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank]!
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1))
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}
