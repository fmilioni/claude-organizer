import { describe, expect, it } from 'vitest'

import {
  archiveCard,
  createCard,
  createIntakeItem,
  destroyCard,
  listIntakeItems,
  markIntakePlanned,
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
