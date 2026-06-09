import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/postgres-js/migrator'

import type { Database } from './client'
import { reconcileEmbeddingDim } from './embeddingSchema'

// Resolve the migrations folder relative to this file so it works regardless of
// the caller's cwd (CLI script, tests under vitest, etc.).
const migrationsFolder = resolve(
  fileURLToPath(import.meta.url),
  '../../migrations'
)

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder })
  // Bring the pgvector columns to the configured model's dimension (no-op when
  // it already matches, which is the default/test case).
  await reconcileEmbeddingDim(db)
}
