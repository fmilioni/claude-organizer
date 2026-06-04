import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { createId, type Database, schema } from '@claude-organizer/db'
import {
  type CardStatus,
  INTAKE_STATUSES,
  type IntakeStatus
} from '@claude-organizer/shared'

import { notify } from './events'

export const createIntakeItemInput = z.object({
  projectId: z.string(),
  bodyMd: z.string().min(1)
})
export type CreateIntakeItemInput = z.infer<typeof createIntakeItemInput>

export const updateIntakeItemInput = z.object({
  id: z.string(),
  bodyMd: z.string().min(1)
})
export type UpdateIntakeItemInput = z.infer<typeof updateIntakeItemInput>

export const intakeStatus = z.enum(INTAKE_STATUSES)

async function notifyChanged(db: Database, row: { id: string, projectId: string }) {
  await notify(db, {
    type: 'inbox.changed',
    projectId: row.projectId,
    intakeId: row.id
  })
}

export function parseCardKeys(csv: string | null): string[] {
  return (csv ?? '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
}

interface CardState {
  status: CardStatus
  archived: boolean
}

/** Resolve card keys → their live status/archived, scoped to the project. */
export async function cardStatesByKeys(
  db: Database,
  projectId: string,
  keys: string[]
): Promise<Map<string, CardState>> {
  const map = new Map<string, CardState>()
  if (keys.length === 0) return map
  const rows = await db
    .select({
      key: schema.cards.key,
      status: schema.cards.status,
      archivedAt: schema.cards.archivedAt
    })
    .from(schema.cards)
    .where(
      and(eq(schema.cards.projectId, projectId), inArray(schema.cards.key, keys))
    )
  for (const r of rows) {
    map.set(r.key, { status: r.status, archived: r.archivedAt !== null })
  }
  return map
}

/** Completed = ≥1 referenced card is non-archived and all such are `done`. */
function deriveCompleted(
  plannedCardKeys: string | null,
  states: Map<string, CardState>
): boolean {
  const active = parseCardKeys(plannedCardKeys)
    .map(k => states.get(k))
    .filter((c): c is CardState => c !== undefined && !c.archived)
  return active.length > 0 && active.every(c => c.status === 'done')
}

export async function listIntakeItems(
  db: Database,
  projectId: string,
  options: { status?: IntakeStatus } = {}
) {
  const conditions = [eq(schema.intakeItems.projectId, projectId)]
  if (options.status) {
    conditions.push(eq(schema.intakeItems.status, options.status))
  }
  const items = await db
    .select()
    .from(schema.intakeItems)
    .where(and(...conditions))
    .orderBy(desc(schema.intakeItems.createdAt))

  const keys = [...new Set(items.flatMap(i => parseCardKeys(i.plannedCardKeys)))]
  const states = await cardStatesByKeys(db, projectId, keys)
  return items.map(item => ({
    ...item,
    completed: deriveCompleted(item.plannedCardKeys, states)
  }))
}

export async function createIntakeItem(db: Database, input: CreateIntakeItemInput) {
  const parsed = createIntakeItemInput.parse(input)
  const [row] = await db
    .insert(schema.intakeItems)
    .values({
      id: createId('itk'),
      projectId: parsed.projectId,
      bodyMd: parsed.bodyMd
    })
    .returning()
  if (row) await notifyChanged(db, row)
  return row
}

export async function updateIntakeItem(db: Database, input: UpdateIntakeItemInput) {
  const parsed = updateIntakeItemInput.parse(input)
  const [row] = await db
    .update(schema.intakeItems)
    .set({ bodyMd: parsed.bodyMd, updatedAt: sql`now()` })
    .where(eq(schema.intakeItems.id, parsed.id))
    .returning()
  if (row) await notifyChanged(db, row)
  return row ?? null
}

export async function markIntakePlanned(
  db: Database,
  id: string,
  cardKeys: string[]
) {
  const keys = cardKeys.filter(Boolean).join(',')
  const [row] = await db
    .update(schema.intakeItems)
    .set({
      status: 'planned',
      plannedCardKeys: keys || null,
      updatedAt: sql`now()`
    })
    .where(eq(schema.intakeItems.id, id))
    .returning()
  if (row) await notifyChanged(db, row)
  return row ?? null
}

export async function archiveIntakeItem(db: Database, id: string) {
  const [row] = await db
    .update(schema.intakeItems)
    .set({ status: 'archived', archivedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(schema.intakeItems.id, id))
    .returning()
  if (row) await notifyChanged(db, row)
  return row ?? null
}

export async function restoreIntakeItem(db: Database, id: string) {
  const [current] = await db
    .select()
    .from(schema.intakeItems)
    .where(eq(schema.intakeItems.id, id))
    .limit(1)
  if (!current) return null
  const nextStatus = current.plannedCardKeys ? 'planned' : 'pending'
  const [row] = await db
    .update(schema.intakeItems)
    .set({ status: nextStatus, archivedAt: null, updatedAt: sql`now()` })
    .where(eq(schema.intakeItems.id, id))
    .returning()
  if (row) await notifyChanged(db, row)
  return row ?? null
}

/** Intake items (the only statuses that carry keys) referencing any of `keys`. */
async function findIntakeItemsByCardKeys(
  db: Database,
  projectId: string,
  keys: string[]
) {
  const keySet = new Set(keys)
  const items = await db
    .select()
    .from(schema.intakeItems)
    .where(
      and(
        eq(schema.intakeItems.projectId, projectId),
        inArray(schema.intakeItems.status, ['planned', 'archived'])
      )
    )
  return items.filter(i =>
    parseCardKeys(i.plannedCardKeys).some(k => keySet.has(k))
  )
}

/**
 * Cascade a card's archive/restore onto the items referencing it: an item with
 * no active (non-archived) card left is archived; one that regains an active
 * card is restored. Idempotent — only writes when the derived state differs.
 */
export async function syncIntakeForCard(
  db: Database,
  projectId: string,
  key: string
) {
  const items = await findIntakeItemsByCardKeys(db, projectId, [key])
  for (const item of items) {
    const itemKeys = parseCardKeys(item.plannedCardKeys)
    const states = await cardStatesByKeys(db, projectId, itemKeys)
    const hasActive = itemKeys.some(k => {
      const s = states.get(k)
      return s !== undefined && !s.archived
    })
    if (!hasActive && item.status !== 'archived') {
      await archiveIntakeItem(db, item.id)
    } else if (hasActive && item.status === 'archived') {
      await restoreIntakeItem(db, item.id)
    }
  }
}

/**
 * Prune destroyed card keys from referencing items: an item left with no keys
 * is destroyed; otherwise the CSV is rewritten and its archived/planned state
 * re-derived from the remaining cards (keeps "archived ⟺ no active card" true).
 */
export async function pruneIntakeForDestroyedCards(
  db: Database,
  projectId: string,
  keys: string[]
) {
  const removed = new Set(keys)
  const items = await findIntakeItemsByCardKeys(db, projectId, keys)
  for (const item of items) {
    const remaining = parseCardKeys(item.plannedCardKeys).filter(
      k => !removed.has(k)
    )
    if (remaining.length === 0) {
      await destroyIntakeItem(db, item.id)
      continue
    }
    const states = await cardStatesByKeys(db, projectId, remaining)
    const hasActive = remaining.some(k => {
      const s = states.get(k)
      return s !== undefined && !s.archived
    })
    const set: Record<string, unknown> = {
      plannedCardKeys: remaining.join(','),
      updatedAt: sql`now()`
    }
    if (hasActive) {
      set.status = 'planned'
      set.archivedAt = null
    } else if (item.status !== 'archived') {
      set.status = 'archived'
      set.archivedAt = sql`now()`
    }
    await db
      .update(schema.intakeItems)
      .set(set)
      .where(eq(schema.intakeItems.id, item.id))
    await notifyChanged(db, item)
  }
}

export async function destroyIntakeItem(db: Database, id: string) {
  const [row] = await db
    .delete(schema.intakeItems)
    .where(eq(schema.intakeItems.id, id))
    .returning()
  if (row) {
    await notify(db, {
      type: 'inbox.deleted',
      projectId: row.projectId,
      intakeId: row.id
    })
  }
  return row ?? null
}
