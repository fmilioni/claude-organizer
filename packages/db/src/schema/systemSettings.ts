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
// `includeAttachmentsInBackup=true` (default) exports attachment bytes in the
// backup envelope; OFF keeps the metadata rows but drops `data` so the envelope
// stays small.
// `keepAttachmentsOnArchive=false` (default) frees attachment bytes when their
// owner is archived and nothing active still references them (mirrors
// keepDiffsOnArchive); ON preserves the bytes.
export const systemSettings = pgTable('system_settings', {
  id: text('id').primaryKey(),
  authEnabled: boolean('auth_enabled').notNull().default(true),
  keepDiffsOnArchive: boolean('keep_diffs_on_archive').notNull().default(false),
  embeddingModel: text('embedding_model'),
  includeAttachmentsInBackup: boolean('include_attachments_in_backup')
    .notNull()
    .default(true),
  keepAttachmentsOnArchive: boolean('keep_attachments_on_archive')
    .notNull()
    .default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
})

export const SYSTEM_SETTINGS_ID = 'system'
