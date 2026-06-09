import { sql } from 'drizzle-orm'
import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Singleton row (id is always 'system'): system-wide config the admin controls.
// `authEnabled=false` is the sem-auth mode — web/API run without sessions, as
// before auth existed (see CO-169). Read via core.getSystemSettings, which
// returns the default when the row was never written.
// `keepDiffsOnArchive=false` reproduces today's archiving (drops the diff blobs);
// turning it on preserves them when a card/sprint is archived.
// `embeddingModel` is tri-state: null = unset (fall back to env/default), 'none' =
// semantic search off, otherwise a model id; it takes precedence over env in
// resolveEmbeddingConfig.
export const systemSettings = pgTable('system_settings', {
  id: text('id').primaryKey(),
  authEnabled: boolean('auth_enabled').notNull().default(true),
  keepDiffsOnArchive: boolean('keep_diffs_on_archive').notNull().default(false),
  embeddingModel: text('embedding_model'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
})

export const SYSTEM_SETTINGS_ID = 'system'
