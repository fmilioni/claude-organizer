import { sql } from 'drizzle-orm'
import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Singleton row (id is always 'system'): system-wide config the admin controls.
// `authEnabled=false` is the sem-auth mode — web/API run without sessions, as
// before auth existed (see CO-169). Read via core.getSystemSettings, which
// returns the default when the row was never written.
// `keepDiffsOnArchive=false` reproduces today's archiving (drops the diff blobs);
// turning it on preserves them when a card/sprint is archived.
// `embeddingModel` is tri-state: null = unset (fall back to env/default), 'none' =
// semantic search off, otherwise a model id; it takes precedence over env in
// resolveEmbeddingConfig.
// `embeddingDtype` is tri-state: null = unset (fall back to EMBEDDING_DTYPE/default
// q8), otherwise a fixed-list dtype (fp32/fp16/q8); same precedence as the model.
// A dtype change is lazy — the dim is identical, so no reconcile/re-embed.
// `includeAttachmentsInBackup=true` (default) exports attachment bytes in the
// backup envelope; OFF keeps the metadata rows but drops `data` so the envelope
// stays small.
// `keepAttachmentsOnArchive=false` (default) frees attachment bytes when their
// owner is archived and nothing active still references them (mirrors
// keepDiffsOnArchive); ON preserves the bytes.
// `hideLooseDoneEnabled=true` (default) auto-hides loose done cards from the
// board `hideLooseDoneAfterDays` (default 7, min 0 = immediately) after they
// completed; the cards stay active and MCP/search-visible (board view only).
export const systemSettings = pgTable('system_settings', {
  id: text('id').primaryKey(),
  authEnabled: boolean('auth_enabled').notNull().default(true),
  keepDiffsOnArchive: boolean('keep_diffs_on_archive').notNull().default(false),
  embeddingModel: text('embedding_model'),
  embeddingDtype: text('embedding_dtype'),
  includeAttachmentsInBackup: boolean('include_attachments_in_backup')
    .notNull()
    .default(true),
  keepAttachmentsOnArchive: boolean('keep_attachments_on_archive')
    .notNull()
    .default(false),
  hideLooseDoneEnabled: boolean('hide_loose_done_enabled')
    .notNull()
    .default(true),
  hideLooseDoneAfterDays: integer('hide_loose_done_after_days')
    .notNull()
    .default(7),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
})

export const SYSTEM_SETTINGS_ID = 'system'
