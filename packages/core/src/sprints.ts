import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { createId, type Database, schema } from '@claude-organizer/db'

import { archivedCondition, type ArchiveFilter } from './archive'
import { gcAttachmentsOnArchive, gcAttachmentsOnDestroy } from './attachmentGc'
import { getSystemSettings } from './authz'
import { notify } from './events'
import { syncIntakeForSprint } from './intake'
import { paginate } from './pagination'

export const createSprintInput = z.object({
  projectId: z.string(),
  roadmapId: z.string().optional(),
  name: z.string().min(1).max(120),
  goal: z.string().max(500).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional()
})
export type CreateSprintInput = z.infer<typeof createSprintInput>

export const updateSprintInput = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  goal: z.string().max(500).nullable().optional()
})
export type UpdateSprintInput = z.infer<typeof updateSprintInput>

const sprintColumns = {
  id: schema.sprints.id,
  projectId: schema.sprints.projectId,
  roadmapId: schema.sprints.roadmapId,
  name: schema.sprints.name,
  goal: schema.sprints.goal,
  status: schema.sprints.status,
  startsAt: schema.sprints.startsAt,
  endsAt: schema.sprints.endsAt,
  createdAt: schema.sprints.createdAt,
  updatedAt: schema.sprints.updatedAt,
  archivedAt: schema.sprints.archivedAt
}

export async function listSprints(
  db: Database,
  projectId: string,
  filter?: ArchiveFilter,
  limit?: number,
  offset?: number
) {
  const conditions = [eq(schema.sprints.projectId, projectId)]
  const archived = archivedCondition(schema.sprints.archivedAt, filter)
  if (archived) conditions.push(archived)
  return paginate(
    db
      .select(sprintColumns)
      .from(schema.sprints)
      .where(and(...conditions))
      .orderBy(schema.sprints.createdAt)
      .$dynamic(),
    limit,
    offset
  )
}

export async function getActiveSprint(db: Database, projectId: string) {
  const [row] = await db
    .select(sprintColumns)
    .from(schema.sprints)
    .where(
      and(
        eq(schema.sprints.projectId, projectId),
        eq(schema.sprints.status, 'active'),
        isNull(schema.sprints.archivedAt)
      )
    )
    .limit(1)
  return row ?? null
}

export async function getSprint(db: Database, id: string) {
  const [row] = await db
    .select(sprintColumns)
    .from(schema.sprints)
    .where(eq(schema.sprints.id, id))
    .limit(1)
  return row ?? null
}

export async function createSprint(db: Database, input: CreateSprintInput) {
  const parsed = createSprintInput.parse(input)
  const [row] = await db
    .insert(schema.sprints)
    .values({
      id: createId('spr'),
      projectId: parsed.projectId,
      roadmapId: parsed.roadmapId,
      name: parsed.name,
      goal: parsed.goal,
      startsAt: parsed.startsAt,
      endsAt: parsed.endsAt,
      status: 'planned'
    })
    .returning(sprintColumns)
  if (row) {
    await notify(db, {
      type: 'sprint.changed',
      projectId: row.projectId,
      sprintId: row.id
    })
  }
  return row
}

export async function updateSprint(db: Database, input: UpdateSprintInput) {
  const parsed = updateSprintInput.parse(input)
  const { id, ...rest } = parsed
  const [row] = await db
    .update(schema.sprints)
    .set({ ...rest, updatedAt: sql`now()` })
    .where(eq(schema.sprints.id, id))
    .returning(sprintColumns)
  if (row) {
    await notify(db, {
      type: 'sprint.changed',
      projectId: row.projectId,
      sprintId: row.id
    })
  }
  return row ?? null
}

// --- Archive / restore / destroy ---

export async function archiveSprint(db: Database, id: string) {
  const [row] = await db
    .update(schema.sprints)
    .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(schema.sprints.id, id))
    .returning(sprintColumns)
  if (row) {
    // Default: drop the diffs of every commit on this sprint's cards (the cards
    // stay active; only the heavy blobs go) — re-run attach-commit to restore.
    // With keepDiffsOnArchive on, the blobs are preserved.
    const sprintCardIds = (
      await db
        .select({ id: schema.cards.id })
        .from(schema.cards)
        .where(eq(schema.cards.sprintId, id))
    ).map(c => c.id)

    const { keepDiffsOnArchive } = await getSystemSettings(db)
    if (!keepDiffsOnArchive && sprintCardIds.length) {
      await db
        .update(schema.cardCommits)
        .set({ diff: null })
        .where(inArray(schema.cardCommits.cardId, sprintCardIds))
    }
    await gcAttachmentsOnArchive(db, {
      projectId: row.projectId,
      cardIds: sprintCardIds
    })
    await syncIntakeForSprint(db, row.projectId, row.id)
    await notify(db, {
      type: 'sprint.changed',
      projectId: row.projectId,
      sprintId: row.id
    })
  }
  return row ?? null
}

export async function restoreSprint(db: Database, id: string) {
  const [row] = await db
    .update(schema.sprints)
    .set({ archivedAt: null, updatedAt: sql`now()` })
    .where(eq(schema.sprints.id, id))
    .returning(sprintColumns)
  if (row) {
    await syncIntakeForSprint(db, row.projectId, row.id)
    await notify(db, {
      type: 'sprint.changed',
      projectId: row.projectId,
      sprintId: row.id
    })
  }
  return row ?? null
}

/**
 * Hard-delete a sprint and its cards. The `cards.sprintId` FK is `set null`,
 * so cards are deleted explicitly (their comments/tags/blockers cascade).
 */
export async function destroySprint(db: Database, id: string) {
  const row = await db.transaction(async (tx) => {
    const [sprint] = await tx
      .select({ id: schema.sprints.id, projectId: schema.sprints.projectId })
      .from(schema.sprints)
      .where(eq(schema.sprints.id, id))
      .limit(1)
    if (!sprint) return null
    const sprintCards = await tx
      .select({ id: schema.cards.id })
      .from(schema.cards)
      .where(eq(schema.cards.sprintId, id))
    await gcAttachmentsOnDestroy(tx, {
      projectId: sprint.projectId,
      cardIds: sprintCards.map(c => c.id)
    })
    await tx.delete(schema.cards).where(eq(schema.cards.sprintId, id))
    await tx.delete(schema.sprints).where(eq(schema.sprints.id, id))
    return sprint
  })
  if (row) {
    await notify(db, {
      type: 'sprint.deleted',
      projectId: row.projectId,
      sprintId: row.id
    })
  }
  return row ?? null
}

export async function startSprint(db: Database, sprintId: string) {
  const row = await db.transaction(async (tx) => {
    const [sprint] = await tx
      .select()
      .from(schema.sprints)
      .where(eq(schema.sprints.id, sprintId))
      .limit(1)
    if (!sprint) return null

    await tx
      .update(schema.sprints)
      .set({ status: 'completed', updatedAt: sql`now()` })
      .where(
        and(
          eq(schema.sprints.projectId, sprint.projectId),
          eq(schema.sprints.status, 'active')
        )
      )

    const [activated] = await tx
      .update(schema.sprints)
      .set({
        status: 'active',
        startsAt: sql`COALESCE(${schema.sprints.startsAt}, now())`,
        updatedAt: sql`now()`
      })
      .where(eq(schema.sprints.id, sprintId))
      .returning(sprintColumns)
    return activated ?? null
  })
  if (row) {
    await notify(db, {
      type: 'sprint.changed',
      projectId: row.projectId,
      sprintId: row.id
    })
  }
  return row
}

/**
 * Reopen a completed (or archived) sprint back to `planned` so work can resume
 * or missing cards can be added. Clears `endsAt` and unarchives it in one move.
 * Never activates — there can be only one active sprint, so reopening goes to
 * `planned` and the user starts it explicitly.
 */
export async function reopenSprint(db: Database, sprintId: string) {
  const [row] = await db
    .update(schema.sprints)
    .set({
      status: 'planned',
      endsAt: null,
      archivedAt: null,
      updatedAt: sql`now()`
    })
    .where(eq(schema.sprints.id, sprintId))
    .returning(sprintColumns)
  if (row) {
    await syncIntakeForSprint(db, row.projectId, row.id)
    await notify(db, {
      type: 'sprint.changed',
      projectId: row.projectId,
      sprintId: row.id
    })
  }
  return row ?? null
}

export async function completeSprint(db: Database, sprintId: string) {
  const [row] = await db
    .update(schema.sprints)
    .set({
      status: 'completed',
      endsAt: sql`COALESCE(${schema.sprints.endsAt}, now())`,
      updatedAt: sql`now()`
    })
    .where(eq(schema.sprints.id, sprintId))
    .returning(sprintColumns)
  if (row) {
    await notify(db, {
      type: 'sprint.changed',
      projectId: row.projectId,
      sprintId: row.id
    })
  }
  return row ?? null
}
