import { relations, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  index,
  integer,
  pgTable,
  text,
  timestamp
} from 'drizzle-orm/pg-core'

import { DEFAULT_EMBEDDING_DIM } from '@claude-organizer/shared'

import { tsvector, vector } from './columns'
import { docKindEnum } from './enums'
import { projects } from './projects'

export const docs = pgTable(
  'docs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnyPgColumn => docs.id, {
      onDelete: 'cascade'
    }),
    title: text('title').notNull(),
    summary: text('summary'),
    bodyMd: text('body_md'),
    kind: docKindEnum('kind').notNull().default('note'),
    position: integer('position').notNull().default(0),
    // Full-text search vector, auto-maintained as a STORED generated column.
    // Config `simple` (no stemming) covers pt-BR and en agnostically.
    bodyTsv: tsvector('body_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body_md, ''))`
    ),
    // App-written semantic embedding; its HNSW index lives in custom migration SQL.
    embedding: vector('embedding', { dimensions: DEFAULT_EMBEDDING_DIM }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    archivedAt: timestamp('archived_at', { withTimezone: true })
  },
  t => [
    index('docs_project_idx').on(t.projectId),
    index('docs_parent_idx').on(t.parentId),
    index('docs_kind_idx').on(t.projectId, t.kind),
    index('docs_body_tsv_idx').using('gin', t.bodyTsv)
  ]
)

export const docsRelations = relations(docs, ({ one, many }) => ({
  project: one(projects, {
    fields: [docs.projectId],
    references: [projects.id]
  }),
  parent: one(docs, {
    fields: [docs.parentId],
    references: [docs.id],
    relationName: 'doc_parent'
  }),
  children: many(docs, { relationName: 'doc_parent' })
}))
