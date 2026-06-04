import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { createId, type Database, schema } from '@claude-organizer/db'

import { archivedCondition, type ArchiveFilter } from './archive'
import { listBlockedBy, listBlocking, pendingBlockerCounts } from './blockers'
import { InputError } from './errors'
import { notify } from './events'
import { pruneIntakeForDestroyedCards, syncIntakeForCard } from './intake'
import { listCardTags, tagsByCardIds } from './tags'

const cardStatus = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'blocked'
])

export const createCardInput = z.object({
  projectId: z.string(),
  sprintId: z.string().optional(),
  title: z.string().min(1).max(200),
  summary: z.string().max(200).optional(),
  descriptionMd: z.string().optional(),
  status: cardStatus.optional(),
  priority: z.number().int().min(0).max(10).optional(),
  dueDate: z.coerce.date().optional(),
  parentId: z.string().optional()
})
export type CreateCardInput = z.infer<typeof createCardInput>

export const updateCardInput = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(200).nullable().optional(),
  descriptionMd: z.string().optional(),
  status: cardStatus.optional(),
  priority: z.number().int().min(0).max(10).optional(),
  position: z.number().int().min(0).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  sprintId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional()
})
export type UpdateCardInput = z.infer<typeof updateCardInput>

export const reorderCardsInput = z.object({
  orderedIds: z.array(z.string()),
  moved: z
    .object({
      id: z.string(),
      status: cardStatus,
      sprintId: z.string().nullable().optional()
    })
    .optional()
})
export type ReorderCardsInput = z.infer<typeof reorderCardsInput>

export interface ListCardsFilters extends ArchiveFilter {
  projectId: string
  sprintId?: string | null
  status?: z.infer<typeof cardStatus>
  backlogOnly?: boolean
}

const cardSummaryColumns = {
  id: schema.cards.id,
  projectId: schema.cards.projectId,
  sprintId: schema.cards.sprintId,
  parentId: schema.cards.parentId,
  key: schema.cards.key,
  title: schema.cards.title,
  summary: schema.cards.summary,
  status: schema.cards.status,
  priority: schema.cards.priority,
  dueDate: schema.cards.dueDate,
  position: schema.cards.position,
  createdAt: schema.cards.createdAt,
  updatedAt: schema.cards.updatedAt
}

export async function listCards(db: Database, filters: ListCardsFilters) {
  const conditions = [eq(schema.cards.projectId, filters.projectId)]
  if (filters.backlogOnly) {
    conditions.push(isNull(schema.cards.sprintId))
  } else if (filters.sprintId !== undefined) {
    conditions.push(
      filters.sprintId === null
        ? isNull(schema.cards.sprintId)
        : eq(schema.cards.sprintId, filters.sprintId)
    )
  }
  if (filters.status) {
    conditions.push(eq(schema.cards.status, filters.status))
  }
  const archived = archivedCondition(schema.cards.archivedAt, filters)
  if (archived) conditions.push(archived)
  const rows = await db
    .select(cardSummaryColumns)
    .from(schema.cards)
    .where(and(...conditions))
    .orderBy(asc(schema.cards.position), desc(schema.cards.createdAt))
  const ids = rows.map(r => r.id)
  const [tagMap, counts, parentKeys, blockerCounts] = await Promise.all([
    tagsByCardIds(db, ids),
    subtaskCounts(db, ids),
    parentKeysFor(db, rows),
    pendingBlockerCounts(db, ids)
  ])
  return rows.map(r => ({
    ...r,
    tags: tagMap.get(r.id) ?? [],
    subtaskCount: counts.get(r.id)?.total ?? 0,
    subtaskDone: counts.get(r.id)?.done ?? 0,
    parentKey: r.parentId ? (parentKeys.get(r.parentId) ?? null) : null,
    blockedByPending: blockerCounts.get(r.id) ?? 0
  }))
}

export async function getCard(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .limit(1)
  if (!row) return null
  return enrichCard(db, row)
}

export async function getCardByKey(db: Database, key: string) {
  const [row] = await db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.key, key))
    .limit(1)
  if (!row) return null
  return enrichCard(db, row)
}

export async function createCard(db: Database, input: CreateCardInput) {
  const parsed = createCardInput.parse(input)
  if (parsed.parentId) {
    await assertParentIsTopLevel(db, parsed.parentId)
  }
  const row = await db.transaction(async (tx) => {
    const [project] = await tx
      .update(schema.projects)
      .set({ nextKeySeq: sql`${schema.projects.nextKeySeq} + 1` })
      .where(eq(schema.projects.id, parsed.projectId))
      .returning({
        keyPrefix: schema.projects.keyPrefix,
        nextSeq: schema.projects.nextKeySeq
      })
    if (!project) {
      throw new InputError(`Project ${parsed.projectId} not found`)
    }
    const cardKey = `${project.keyPrefix}-${project.nextSeq - 1}`
    const [created] = await tx
      .insert(schema.cards)
      .values({
        id: createId('crd'),
        projectId: parsed.projectId,
        sprintId: parsed.sprintId,
        parentId: parsed.parentId,
        key: cardKey,
        title: parsed.title,
        summary: parsed.summary,
        descriptionMd: parsed.descriptionMd,
        // A card with no sprint lands in the backlog (its own status); one
        // created straight into a sprint starts on the board instead.
        status: parsed.status ?? (parsed.sprintId ? 'todo' : 'backlog'),
        priority: parsed.priority ?? 0,
        dueDate: parsed.dueDate
      })
      .returning()
    return created
  })
  if (row) {
    await notify(db, {
      type: 'card.changed',
      projectId: row.projectId,
      cardId: row.id,
      cardKey: row.key
    })
  }
  return row
}

export async function updateCard(db: Database, input: UpdateCardInput) {
  const parsed = updateCardInput.parse(input)
  const { id, ...rest } = parsed
  if (rest.parentId != null) {
    await assertValidParent(db, id, rest.parentId)
  }
  const [row] = await db
    .update(schema.cards)
    .set({ ...rest, updatedAt: sql`now()` })
    .where(eq(schema.cards.id, id))
    .returning()
  if (row) {
    await notify(db, {
      type: 'card.changed',
      projectId: row.projectId,
      cardId: row.id,
      cardKey: row.key
    })
  }
  return row ?? null
}

/**
 * Persist a column's order: write `position = index` for `orderedIds`. If a card
 * changed columns (`moved`), apply its new status (and sprintId when provided)
 * in the same transaction. Emits a single card.changed (for the moved card, or
 * the first reordered one) so other clients refresh.
 */
export async function reorderCards(db: Database, input: ReorderCardsInput) {
  const { orderedIds, moved } = reorderCardsInput.parse(input)
  const row = await db.transaction(async (tx) => {
    if (moved) {
      const set: Record<string, unknown> = {
        status: moved.status,
        updatedAt: sql`now()`
      }
      if (moved.sprintId !== undefined) set.sprintId = moved.sprintId
      await tx.update(schema.cards).set(set).where(eq(schema.cards.id, moved.id))
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(schema.cards)
        .set({ position: i })
        .where(eq(schema.cards.id, orderedIds[i]!))
    }
    const probeId = moved?.id ?? orderedIds[0]
    if (!probeId) return null
    const [c] = await tx
      .select({
        id: schema.cards.id,
        projectId: schema.cards.projectId,
        key: schema.cards.key
      })
      .from(schema.cards)
      .where(eq(schema.cards.id, probeId))
      .limit(1)
    return c ?? null
  })
  if (row) {
    await notify(db, {
      type: 'card.changed',
      projectId: row.projectId,
      cardId: row.id,
      cardKey: row.key
    })
  }
  return row
}

export async function moveCardToBacklog(db: Database, cardId: string) {
  return updateCard(db, { id: cardId, sprintId: null })
}

export async function moveCardToSprint(
  db: Database,
  cardId: string,
  sprintId: string
) {
  return updateCard(db, { id: cardId, sprintId })
}

// --- Archive / restore / destroy ---

export async function archiveCard(db: Database, id: string) {
  const [row] = await db
    .update(schema.cards)
    .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(schema.cards.id, id))
    .returning()
  if (row) {
    // Free the heavy diff blobs; keep the commit metadata (hash, message,
    // stat…). Restoring does NOT bring the diff back — re-run attach-commit.
    await db
      .update(schema.cardCommits)
      .set({ diff: null })
      .where(eq(schema.cardCommits.cardId, id))
    await syncIntakeForCard(db, row.projectId, row.key)
    await notify(db, {
      type: 'card.changed',
      projectId: row.projectId,
      cardId: row.id,
      cardKey: row.key
    })
  }
  return row ?? null
}

export async function restoreCard(db: Database, id: string) {
  const [row] = await db
    .update(schema.cards)
    .set({ archivedAt: null, updatedAt: sql`now()` })
    .where(eq(schema.cards.id, id))
    .returning()
  if (row) {
    await syncIntakeForCard(db, row.projectId, row.key)
    await notify(db, {
      type: 'card.changed',
      projectId: row.projectId,
      cardId: row.id,
      cardKey: row.key
    })
  }
  return row ?? null
}

/**
 * Hard-delete a card. Comments, tags and blocker links cascade via FK.
 * Sub-tasks reference their parent with `set null`, so they are deleted
 * explicitly here (hierarchy is one level deep).
 */
export async function destroyCard(db: Database, id: string) {
  const result = await db.transaction(async (tx) => {
    const [card] = await tx
      .select({
        id: schema.cards.id,
        projectId: schema.cards.projectId,
        key: schema.cards.key
      })
      .from(schema.cards)
      .where(eq(schema.cards.id, id))
      .limit(1)
    if (!card) return null
    const subs = await tx
      .select({ key: schema.cards.key })
      .from(schema.cards)
      .where(eq(schema.cards.parentId, id))
    await tx.delete(schema.cards).where(eq(schema.cards.parentId, id))
    await tx.delete(schema.cards).where(eq(schema.cards.id, id))
    return { card, keys: [card.key, ...subs.map(s => s.key)] }
  })
  if (result) {
    await pruneIntakeForDestroyedCards(db, result.card.projectId, result.keys)
    await notify(db, {
      type: 'card.deleted',
      projectId: result.card.projectId,
      cardId: result.card.id
    })
  }
  return result?.card ?? null
}

// --- Hierarchy (parent story / sub-tasks) ---

const subtaskColumns = {
  id: schema.cards.id,
  key: schema.cards.key,
  title: schema.cards.title,
  status: schema.cards.status,
  priority: schema.cards.priority
}

export async function listSubtasks(db: Database, parentId: string) {
  return db
    .select(subtaskColumns)
    .from(schema.cards)
    .where(eq(schema.cards.parentId, parentId))
    .orderBy(asc(schema.cards.position), asc(schema.cards.key))
}

async function enrichCard(db: Database, row: typeof schema.cards.$inferSelect) {
  const [tags, subtasks, parent, blockedBy, blocking] = await Promise.all([
    listCardTags(db, row.id),
    listSubtasks(db, row.id),
    row.parentId
      ? db
          .select({
            id: schema.cards.id,
            key: schema.cards.key,
            title: schema.cards.title,
            status: schema.cards.status
          })
          .from(schema.cards)
          .where(eq(schema.cards.id, row.parentId))
          .limit(1)
          .then(r => r[0] ?? null)
      : Promise.resolve(null),
    listBlockedBy(db, row.id),
    listBlocking(db, row.id)
  ])
  return { ...row, tags, subtasks, parent, blockedBy, blocking }
}

async function assertParentIsTopLevel(db: Database, parentId: string) {
  const [parent] = await db
    .select({ parentId: schema.cards.parentId })
    .from(schema.cards)
    .where(eq(schema.cards.id, parentId))
    .limit(1)
  if (!parent) throw new InputError(`Parent card ${parentId} not found`)
  if (parent.parentId) {
    throw new InputError('Cannot nest under a card that is already a sub-task')
  }
}

async function assertValidParent(
  db: Database,
  childId: string,
  parentId: string
) {
  if (parentId === childId) {
    throw new InputError('A card cannot be its own parent')
  }
  await assertParentIsTopLevel(db, parentId)
  const [childCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.cards)
    .where(eq(schema.cards.parentId, childId))
  if (childCount && childCount.count > 0) {
    throw new InputError('A card with sub-tasks cannot become a sub-task itself')
  }
}

async function subtaskCounts(db: Database, parentIds: string[]) {
  const map = new Map<string, { total: number, done: number }>()
  if (parentIds.length === 0) return map
  const rows = await db
    .select({
      parentId: schema.cards.parentId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${schema.cards.status} = 'done')::int`
    })
    .from(schema.cards)
    .where(inArray(schema.cards.parentId, parentIds))
    .groupBy(schema.cards.parentId)
  for (const r of rows) {
    if (r.parentId) map.set(r.parentId, { total: r.total, done: r.done })
  }
  return map
}

async function parentKeysFor(
  db: Database,
  rows: { parentId: string | null }[]
) {
  const map = new Map<string, string>()
  const parentIds = [
    ...new Set(
      rows.map(r => r.parentId).filter((p): p is string => p !== null)
    )
  ]
  if (parentIds.length === 0) return map
  const parents = await db
    .select({ id: schema.cards.id, key: schema.cards.key })
    .from(schema.cards)
    .where(inArray(schema.cards.id, parentIds))
  for (const p of parents) map.set(p.id, p.key)
  return map
}
