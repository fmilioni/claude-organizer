import { relations, sql } from 'drizzle-orm'
import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core'

import { cards } from './cards'
import { docs } from './docs'
import { repoProviderEnum } from './enums'
import { roadmaps } from './roadmaps'
import { sprints } from './sprints'
import { tags } from './tags'

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    keyPrefix: text('key_prefix').notNull(),
    nextKeySeq: integer('next_key_seq').notNull().default(1),
    repoProvider: repoProviderEnum('repo_provider'),
    repoWebUrl: text('repo_web_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    archivedAt: timestamp('archived_at', { withTimezone: true })
  },
  t => [uniqueIndex('projects_slug_uk').on(t.slug)]
)

export const projectsRelations = relations(projects, ({ many }) => ({
  roadmaps: many(roadmaps),
  sprints: many(sprints),
  cards: many(cards),
  tags: many(tags),
  docs: many(docs)
}))
