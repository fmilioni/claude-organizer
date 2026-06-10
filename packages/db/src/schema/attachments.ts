import { relations, sql } from 'drizzle-orm'
import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { bytea } from './columns'
import { attachmentOwnerTypeEnum } from './enums'
import { projects } from './projects'

// Owner link (ownerType/ownerId) is optional and polymorphic across
// card/comment/doc/inbox, so ownerId is a plain column with no FK; the markdown
// reference is the source of truth. projectId scopes the row (and the backup).
// `data` is nullable so a backup exported with includeAttachmentsInBackup OFF
// can round-trip the metadata while leaving the bytes out.
export const attachments = pgTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ownerType: attachmentOwnerTypeEnum('owner_type'),
    ownerId: text('owner_id'),
    mime: text('mime').notNull(),
    filename: text('filename'),
    byteSize: integer('byte_size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    description: text('description'),
    data: bytea('data'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
  },
  t => [
    index('attachments_project_idx').on(t.projectId),
    index('attachments_owner_idx').on(t.ownerType, t.ownerId)
  ]
)

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  project: one(projects, {
    fields: [attachments.projectId],
    references: [projects.id]
  })
}))
