/**
 * Conditionally apply `limit`/`offset` to a Drizzle `$dynamic()` query. Unset
 * params leave the query uncapped — the core never imposes a default cap; the
 * MCP border does (see ADR doc_p6w3rck1ssu3). The structural constraint matches
 * any dynamic query whose `.limit()`/`.offset()` return the same type.
 */
export function paginate<
  T extends { limit(n: number): T, offset(n: number): T }
>(query: T, limit?: number, offset?: number): T {
  let q = query
  if (limit !== undefined) q = q.limit(limit)
  if (offset !== undefined) q = q.offset(offset)
  return q
}
