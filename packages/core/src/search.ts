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

// Candidate cap for the HYBRID search path only (lexical-only search stays
// uncapped). Bounds the lexical list fed to RRF; generous so deep-ish pagination
// still has ranked rows. Shared by searchDocs and searchCards.
export const LEXICAL_POOL = 200

/** pgvector text literal (`[a,b,c]`) for a KNN query param (`… <=> $1::vector`). */
export function toVectorParam(vec: number[]): string {
  return `[${vec.join(',')}]`
}

/**
 * How many nearest neighbours the vector branch contributes to the fusion
 * (`EMBEDDING_VECTOR_K`, default 10). e5's high cosine baseline makes an absolute
 * distance threshold unreliable (measured: related ~0.09–0.15 vs unrelated
 * ~0.16–0.18 — overlapping), so the bound is a small top-K by rank, not a cutoff:
 * the true semantic hit ranks first and surfaces, while the far tail is capped.
 */
export function vectorK(): number {
  const raw = process.env.EMBEDDING_VECTOR_K?.trim()
  const n = raw ? Number(raw) : 10
  return Number.isInteger(n) && n > 0 ? n : 10
}

/**
 * Final id order for a hybrid search: fuse the lexical and vector rankings by RRF.
 * The lexical list is passed first so it wins score ties — RRF sums into a Map
 * (insertion-ordered) and the sort is stable, so an exact lexical hit never loses
 * to a vector-only hit on an equal RRF score. (Callers take the lexical-only path
 * when the query can't be embedded, so both lists are always present here.)
 */
export function hybridOrder(lexicalIds: string[], vectorIds: string[]): string[] {
  return reciprocalRankFusion([lexicalIds, vectorIds]).map(f => f.id)
}
