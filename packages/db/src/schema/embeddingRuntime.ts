import { sql } from 'drizzle-orm'
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// One row per long-lived process that loads the embedding model (currently just
// the MCP, which — unlike the API — can't reset its in-process singleton when the
// model is changed via the admin action, so it serves the old model until it is
// restarted). The process writes the model/dim it actually loaded at boot;
// getEmbeddingStatus compares it to the persisted choice to flag a stale process
// durably (the API's own ephemeral apply flag is reset on restart). `model` is
// null when that process has embeddings disabled.
export const embeddingRuntime = pgTable('embedding_runtime', {
  service: text('service').primaryKey(),
  model: text('model'),
  dim: integer('dim').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
})
