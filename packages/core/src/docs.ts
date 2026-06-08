import { and, asc, desc, eq, ilike, isNotNull, notInArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { createId, type Database, schema } from '@claude-organizer/db'

import type { ArchiveFilter } from './archive'
import { notify } from './events'
import { paginate } from './pagination'

const docKind = z.enum(['module', 'adr', 'guide', 'note'])

export const createDocInput = z.object({
  projectId: z.string(),
  parentId: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  summary: z.string().max(200).optional(),
  bodyMd: z.string().optional(),
  kind: docKind.optional(),
  position: z.number().int().min(0).optional()
})
export type CreateDocInput = z.infer<typeof createDocInput>

export const updateDocInput = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(200).nullable().optional(),
  bodyMd: z.string().nullable().optional(),
  kind: docKind.optional(),
  parentId: z.string().nullable().optional(),
  position: z.number().int().min(0).optional()
})
export type UpdateDocInput = z.infer<typeof updateDocInput>

const docListColumns = {
  id: schema.docs.id,
  projectId: schema.docs.projectId,
  parentId: schema.docs.parentId,
  title: schema.docs.title,
  summary: schema.docs.summary,
  kind: schema.docs.kind,
  position: schema.docs.position,
  createdAt: schema.docs.createdAt,
  updatedAt: schema.docs.updatedAt
}

// Allow-list, not a bare select: bodyTsv can't leak into read_doc or a doc
// mutation return.
const docDetailColumns = {
  ...docListColumns,
  bodyMd: schema.docs.bodyMd
}

export async function listDocs(
  db: Database,
  projectId: string,
  kind?: z.infer<typeof docKind>,
  filter?: ArchiveFilter,
  limit?: number,
  offset?: number
) {
  const conditions = [eq(schema.docs.projectId, projectId)]
  if (kind) conditions.push(eq(schema.docs.kind, kind))
  if (filter?.archivedOnly) {
    conditions.push(isNotNull(schema.docs.archivedAt))
  } else if (!filter?.includeArchived) {
    // Hide archived docs AND their descendants: a child "travels" with an
    // archived parent even though it isn't marked archived itself.
    const hidden = await archivedDocSubtreeIds(db, projectId)
    if (hidden.length > 0) {
      conditions.push(notInArray(schema.docs.id, hidden))
    }
  }
  return paginate(
    db
      .select(docListColumns)
      .from(schema.docs)
      .where(and(...conditions))
      .orderBy(asc(schema.docs.position), asc(schema.docs.title))
      .$dynamic(),
    limit,
    offset
  )
}

/** Ids of every doc that is archived or descends from an archived doc. */
async function archivedDocSubtreeIds(
  db: Database,
  projectId: string
): Promise<string[]> {
  const rows = (await db.execute(sql`
    WITH RECURSIVE archived_tree AS (
      SELECT id FROM docs
      WHERE project_id = ${projectId} AND archived_at IS NOT NULL
      UNION ALL
      SELECT d.id FROM docs d
      JOIN archived_tree a ON d.parent_id = a.id
    )
    SELECT id FROM archived_tree
  `)) as unknown as Array<{ id: string }>
  return rows.map(r => r.id)
}

export async function getDoc(db: Database, id: string) {
  const [row] = await db
    .select(docDetailColumns)
    .from(schema.docs)
    .where(eq(schema.docs.id, id))
    .limit(1)
  return row ?? null
}

export async function createDoc(db: Database, input: CreateDocInput) {
  const parsed = createDocInput.parse(input)
  const [row] = await db
    .insert(schema.docs)
    .values({
      id: createId('doc'),
      projectId: parsed.projectId,
      parentId: parsed.parentId ?? null,
      title: parsed.title,
      summary: parsed.summary,
      bodyMd: parsed.bodyMd,
      kind: parsed.kind ?? 'note',
      position: parsed.position ?? 0
    })
    .returning(docDetailColumns)
  if (row) {
    await notify(db, { type: 'doc.changed', projectId: row.projectId, docId: row.id })
  }
  return row
}

export async function updateDoc(db: Database, input: UpdateDocInput) {
  const parsed = updateDocInput.parse(input)
  const { id, ...rest } = parsed
  const [row] = await db
    .update(schema.docs)
    .set({ ...rest, updatedAt: sql`now()` })
    .where(eq(schema.docs.id, id))
    .returning(docDetailColumns)
  if (row) {
    await notify(db, { type: 'doc.changed', projectId: row.projectId, docId: row.id })
  }
  return row ?? null
}

// --- Archive / restore / destroy ---

export async function archiveDoc(db: Database, id: string) {
  const [row] = await db
    .update(schema.docs)
    .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(schema.docs.id, id))
    .returning(docDetailColumns)
  if (row) {
    await notify(db, { type: 'doc.changed', projectId: row.projectId, docId: row.id })
  }
  return row ?? null
}

export async function restoreDoc(db: Database, id: string) {
  const [row] = await db
    .update(schema.docs)
    .set({ archivedAt: null, updatedAt: sql`now()` })
    .where(eq(schema.docs.id, id))
    .returning(docDetailColumns)
  if (row) {
    await notify(db, { type: 'doc.changed', projectId: row.projectId, docId: row.id })
  }
  return row ?? null
}

/** Hard-delete a doc and its descendants (children cascade via FK). */
export async function destroyDoc(db: Database, id: string) {
  const [row] = await db
    .delete(schema.docs)
    .where(eq(schema.docs.id, id))
    .returning({ id: schema.docs.id, projectId: schema.docs.projectId })
  if (row) {
    await notify(db, {
      type: 'doc.deleted',
      projectId: row.projectId,
      docId: row.id
    })
  }
  return row ?? null
}

export async function searchDocs(
  db: Database,
  projectId: string,
  query: string,
  limit?: number,
  offset?: number
) {
  // Without this, a whitespace-only query degenerates into ILIKE '%   %' (matches all).
  const q = query.trim()
  if (!q) return []
  // Full-text ranked via tsvector (config `simple`, language-agnostic).
  // websearch_to_tsquery accepts free user input without throwing a syntax error.
  const tsQuery = sql`websearch_to_tsquery('simple', ${q})`
  const rank = sql<number>`ts_rank(${schema.docs.bodyTsv}, ${tsQuery})`
  // FTS `simple` matches whole tokens only; ILIKE covers substring/prefix and
  // pg_trgm `<%` (word-similarity) covers typos on title/summary. ts_rank stays
  // the primary sort; the trigram similarity is only a tie-breaker (additional
  // recall), so it never outranks a real full-text hit.
  const trgmSim = sql<number>`greatest(
    word_similarity(${q}, ${schema.docs.title}),
    word_similarity(${q}, coalesce(${schema.docs.summary}, ''))
  )`
  const term = `%${q}%`
  return paginate(
    db
      .select(docListColumns)
      .from(schema.docs)
      .where(
        and(
          eq(schema.docs.projectId, projectId),
          or(
            sql`${schema.docs.bodyTsv} @@ ${tsQuery}`,
            ilike(schema.docs.title, term),
            ilike(schema.docs.summary, term),
            sql`${q} <% ${schema.docs.title}`,
            sql`${q} <% coalesce(${schema.docs.summary}, '')`
          )
        )
      )
      .orderBy(desc(rank), desc(trgmSim), desc(schema.docs.updatedAt))
      .$dynamic(),
    limit,
    offset
  )
}
