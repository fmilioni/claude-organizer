import { describe, expect, it } from 'vitest'

import {
  addBlocker,
  createCard,
  pendingBlockerCounts,
  updateCard
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()

async function makeBlocked(prefix: string) {
  const project = await freshProject(ctx.db, prefix)
  const blocked = await createCard(ctx.db, {
    projectId: project.id,
    title: 'blocked'
  })
  const blocker = await createCard(ctx.db, {
    projectId: project.id,
    title: 'blocker'
  })
  await addBlocker(ctx.db, blocked.id, blocker.id)
  return { blocked, blocker }
}

async function pending(cardId: string) {
  return (await pendingBlockerCounts(ctx.db, [cardId])).get(cardId) ?? 0
}

describe('pendingBlockerCounts — review satisfies a blocker', () => {
  it('a todo blocker keeps the dependent blocked', async () => {
    const { blocked } = await makeBlocked('BLK1')
    expect(await pending(blocked.id)).toBe(1)
  })

  it('an in_progress blocker still blocks', async () => {
    const { blocked, blocker } = await makeBlocked('BLK2')
    await updateCard(ctx.db, { id: blocker.id, status: 'in_progress' })
    expect(await pending(blocked.id)).toBe(1)
  })

  it('a blocker in review no longer blocks', async () => {
    const { blocked, blocker } = await makeBlocked('BLK3')
    await updateCard(ctx.db, { id: blocker.id, status: 'review' })
    expect(await pending(blocked.id)).toBe(0)
  })

  it('a done blocker no longer blocks', async () => {
    const { blocked, blocker } = await makeBlocked('BLK4')
    await updateCard(ctx.db, { id: blocker.id, status: 'done' })
    expect(await pending(blocked.id)).toBe(0)
  })

  it('with multiple blockers, unblocks only when all are review/done', async () => {
    const project = await freshProject(ctx.db, 'BLK5')
    const blocked = await createCard(ctx.db, {
      projectId: project.id,
      title: 'blocked'
    })
    const b1 = await createCard(ctx.db, { projectId: project.id, title: 'b1' })
    const b2 = await createCard(ctx.db, { projectId: project.id, title: 'b2' })
    await addBlocker(ctx.db, blocked.id, b1.id)
    await addBlocker(ctx.db, blocked.id, b2.id)
    expect(await pending(blocked.id)).toBe(2)

    await updateCard(ctx.db, { id: b1.id, status: 'review' })
    expect(await pending(blocked.id)).toBe(1)

    await updateCard(ctx.db, { id: b2.id, status: 'done' })
    expect(await pending(blocked.id)).toBe(0)
  })
})
