import { describe, expect, it } from 'vitest'

import {
  archiveCard,
  createCard,
  createIntakeItem,
  destroyCard,
  listIntakeItems,
  markIntakePlanned,
  restoreCard,
  updateCard
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()

async function plannedItemWithCards(projectId: string, titles: string[]) {
  const cards = await Promise.all(
    titles.map(title => createCard(ctx.db, { projectId, title }))
  )
  const item = await createIntakeItem(ctx.db, { projectId, bodyMd: 'demand' })
  await markIntakePlanned(ctx.db, item.id, cards.map(c => c.key))
  return { item, cards }
}

async function completedFlag(projectId: string, itemId: string) {
  const items = await listIntakeItems(ctx.db, projectId)
  return items.find(i => i.id === itemId)?.completed
}

describe('intake completion derived from card status', () => {
  it('is completed when all referenced cards are done', async () => {
    const project = await freshProject(ctx.db)
    const { item, cards } = await plannedItemWithCards(project.id, ['a', 'b'])
    for (const c of cards) await updateCard(ctx.db, { id: c.id, status: 'done' })
    expect(await completedFlag(project.id, item.id)).toBe(true)
  })

  it('is not completed while any card is still in progress', async () => {
    const project = await freshProject(ctx.db)
    const { item, cards } = await plannedItemWithCards(project.id, ['a', 'b'])
    await updateCard(ctx.db, { id: cards[0]!.id, status: 'done' })
    await updateCard(ctx.db, { id: cards[1]!.id, status: 'in_progress' })
    expect(await completedFlag(project.id, item.id)).toBe(false)
  })

  it('is not completed when every referenced card is archived', async () => {
    const project = await freshProject(ctx.db)
    const { item, cards } = await plannedItemWithCards(project.id, ['a', 'b'])
    for (const c of cards) {
      await updateCard(ctx.db, { id: c.id, status: 'done' })
      await archiveCard(ctx.db, c.id)
    }
    expect(await completedFlag(project.id, item.id)).toBe(false)
  })

  it('ignores archived cards and counts only the live ones', async () => {
    const project = await freshProject(ctx.db)
    const { item, cards } = await plannedItemWithCards(project.id, ['a', 'b'])
    await updateCard(ctx.db, { id: cards[0]!.id, status: 'done' })
    await updateCard(ctx.db, { id: cards[1]!.id, status: 'in_progress' })
    await archiveCard(ctx.db, cards[1]!.id)
    expect(await completedFlag(project.id, item.id)).toBe(true)
  })

  it('ignores destroyed cards when deriving completion', async () => {
    const project = await freshProject(ctx.db)
    const { item, cards } = await plannedItemWithCards(project.id, ['a', 'b'])
    await updateCard(ctx.db, { id: cards[0]!.id, status: 'done' })
    await destroyCard(ctx.db, cards[1]!.id)
    expect(await completedFlag(project.id, item.id)).toBe(true)
  })
})

async function findItem(projectId: string, itemId: string) {
  const items = await listIntakeItems(ctx.db, projectId)
  return items.find(i => i.id === itemId)
}

describe('intake cascade on card archive/restore/destroy', () => {
  it('archives the item when its last active card is archived, restores on undo', async () => {
    const project = await freshProject(ctx.db)
    const { item, cards } = await plannedItemWithCards(project.id, ['a', 'b'])
    await archiveCard(ctx.db, cards[0]!.id)
    expect((await findItem(project.id, item.id))?.status).toBe('planned')
    await archiveCard(ctx.db, cards[1]!.id)
    expect((await findItem(project.id, item.id))?.status).toBe('archived')
    await restoreCard(ctx.db, cards[1]!.id)
    expect((await findItem(project.id, item.id))?.status).toBe('planned')
  })

  it('destroys the item when all its cards are destroyed', async () => {
    const project = await freshProject(ctx.db)
    const { item, cards } = await plannedItemWithCards(project.id, ['a', 'b'])
    await destroyCard(ctx.db, cards[0]!.id)
    await destroyCard(ctx.db, cards[1]!.id)
    expect(await findItem(project.id, item.id)).toBeUndefined()
  })

  it('prunes the destroyed key and keeps the item planned when others remain', async () => {
    const project = await freshProject(ctx.db)
    const { item, cards } = await plannedItemWithCards(project.id, ['a', 'b'])
    await destroyCard(ctx.db, cards[0]!.id)
    const after = await findItem(project.id, item.id)
    expect(after?.status).toBe('planned')
    expect(after?.plannedCardKeys).toBe(cards[1]!.key)
  })

  it('prunes keys of destroyed subtasks, not just the parent', async () => {
    const project = await freshProject(ctx.db)
    const parent = await createCard(ctx.db, { projectId: project.id, title: 'p' })
    const child = await createCard(ctx.db, {
      projectId: project.id,
      title: 'c',
      parentId: parent.id
    })
    const item = await createIntakeItem(ctx.db, {
      projectId: project.id,
      bodyMd: 'demand'
    })
    await markIntakePlanned(ctx.db, item.id, [parent.key, child.key])
    await destroyCard(ctx.db, parent.id)
    expect(await findItem(project.id, item.id)).toBeUndefined()
  })
})
