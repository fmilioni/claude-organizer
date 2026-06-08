import { customType } from 'drizzle-orm/pg-core'

/** Postgres `tsvector` column for full-text search (docs, cards, comments). */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  }
})
