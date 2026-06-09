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
