import { relations, sql } from 'drizzle-orm'
import {
  index,
  pgTable,
  text,
  timestamp
} from 'drizzle-orm/pg-core'

import { users } from './auth'
import { cards } from './cards'
import { tsvector } from './columns'
import { commentAiStatusEnum, commentAuthorEnum } from './enums'

export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    author: commentAuthorEnum('author').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    bodyMd: text('body_md').notNull(),
    aiStatus: commentAiStatusEnum('ai_status').notNull().default('unread'),
    bodyTsv: tsvector('body_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(body_md, ''))`
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
  },
  t => [
    index('comments_card_idx').on(t.cardId),
    index('comments_unread_idx').on(t.aiStatus, t.author),
    index('comments_body_tsv_idx').using('gin', t.bodyTsv)
  ]
)

export const commentsRelations = relations(comments, ({ one }) => ({
  card: one(cards, { fields: [comments.cardId], references: [cards.id] })
}))
