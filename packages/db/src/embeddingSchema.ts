import { eq, sql } from 'drizzle-orm'

import { resolveEmbeddingConfig } from '@claude-organizer/shared'

import type { Database } from './client'
import { SYSTEM_SETTINGS_ID, systemSettings } from './schema/systemSettings'

const EMBEDDING_TABLES = ['docs', 'cards', 'comments'] as const

/**
 * Reconcile the live `vector(N)` columns to the configured model's dimension.
 *
 * The base migration creates the columns at the baseline (default model) dim;
 * this brings them to whatever `EMBEDDING_MODEL` resolves to. A dim change drops
 * and recreates the column (+ HNSW index), discarding existing embeddings — they
 * belong to a different vector space and must be re-backfilled anyway. A no-op
 * when the dim already matches (the common case, incl. tests and the default).
 *
 * pgvector stores the dimension in `atttypmod` directly (-1 when unspecified).
 */
export async function reconcileEmbeddingDim(db: Database): Promise<void> {
  // Honor the persisted choice (read straight from the table to avoid a core
  // dependency); falls back to env/default when unset or the row doesn't exist.
  const [settings] = await db
    .select({ embeddingModel: systemSettings.embeddingModel })
    .from(systemSettings)
    .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
    .limit(1)
  const { dim } = resolveEmbeddingConfig(undefined, settings?.embeddingModel)
  for (const table of EMBEDDING_TABLES) {
    const rows = (await db.execute(sql`
      select a.atttypmod as typmod
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where c.relname = ${table}
        and a.attname = 'embedding'
        and n.nspname = current_schema()
        and a.attnum > 0 and not a.attisdropped
    `)) as unknown as Array<{ typmod: number }>
    const current = rows[0]?.typmod
    if (current === dim) continue
    // Dropping the column takes its index with it; recreate both at the new dim.
    await db.execute(
      sql.raw(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "embedding"`)
    )
    await db.execute(
      sql.raw(`ALTER TABLE "${table}" ADD COLUMN "embedding" vector(${dim})`)
    )
    await db.execute(
      sql.raw(
        `CREATE INDEX "${table}_embedding_idx" ON "${table}" USING hnsw ("embedding" vector_cosine_ops)`
      )
    )
  }
}
