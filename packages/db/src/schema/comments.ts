import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp
} from 'drizzle-orm/pg-core'

import { DEFAULT_EMBEDDING_DIM } from '@claude-organizer/shared'

import { users } from './auth'
import { cards } from './cards'
import { tsvector, vector } from './columns'
import { commentAuthorEnum } from './enums'

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
    readByAi: boolean('read_by_ai').notNull().default(false),
    bodyTsv: tsvector('body_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(body_md, ''))`
    ),
    // App-written semantic embedding; its HNSW index lives in custom migration SQL.
    embedding: vector('embedding', { dimensions: DEFAULT_EMBEDDING_DIM }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
  },
  t => [
    index('comments_card_idx').on(t.cardId),
    index('comments_unread_idx').on(t.readByAi, t.author),
    index('comments_body_tsv_idx').using('gin', t.bodyTsv)
  ]
)

export const commentsRelations = relations(comments, ({ one }) => ({
  card: one(cards, { fields: [comments.cardId], references: [cards.id] })
}))
