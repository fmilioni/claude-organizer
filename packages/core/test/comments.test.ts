import { describe, expect, it } from 'vitest'

import {
  addComment,
  createCard,
  listComments,
  listUnhandledCommentsForProject,
  markCommentsHandled
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()

describe('comment AI status', () => {
  it('a user comment is born unread and an AI comment is born handled', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'c' })

    const userComment = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'please check this'
    })
    expect(userComment.aiStatus).toBe('unread')

    const aiComment = await addComment(ctx.db, {
      cardId: card.id,
      author: 'ai',
      bodyMd: 'progress note'
    })
    expect(aiComment.aiStatus).toBe('handled')

    const unhandled = await listUnhandledCommentsForProject(ctx.db, project.id)
    expect(unhandled.map(u => u.id)).toContain(userComment.id)
    expect(unhandled.map(u => u.id)).not.toContain(aiComment.id)
  })

  it('listComments with advanceToRead moves unread → read without demoting handled or re-promoting read', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'c' })

    const unread = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'still unread'
    })
    const alreadyRead = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'already read'
    })
    const handled = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'already handled'
    })

    await listComments(ctx.db, card.id, { advanceToRead: true })
    await markCommentsHandled(ctx.db, [handled.id])
    // `alreadyRead` is now `read` (advanced above); `handled` is `handled`.

    const advanced = await listComments(ctx.db, card.id, { advanceToRead: true })
    // The advancing call must return the just-written state, not the pre-update rows.
    expect(new Map(advanced.map(r => [r.id, r.aiStatus])).get(unread.id)).toBe('read')

    const rows = await listComments(ctx.db, card.id)
    const byId = new Map(rows.map(r => [r.id, r.aiStatus]))
    expect(byId.get(unread.id)).toBe('read')
    expect(byId.get(alreadyRead.id)).toBe('read')
    expect(byId.get(handled.id)).toBe('handled')
  })

  it('listComments without advanceToRead changes nothing', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'c' })
    const comment = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'leave me alone'
    })

    await listComments(ctx.db, card.id)

    const [row] = await listComments(ctx.db, card.id)
    expect(row?.aiStatus).toBe('unread')
    const unhandled = await listUnhandledCommentsForProject(ctx.db, project.id)
    expect(unhandled.map(u => u.id)).toContain(comment.id)
  })

  it('markCommentsHandled drives any state to handled and returns the count', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'c' })
    const c1 = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'one'
    })
    const c2 = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'two'
    })
    // Move c1 to `read` first to prove handled wins from any prior state.
    await listComments(ctx.db, card.id, { advanceToRead: true })

    const count = await markCommentsHandled(ctx.db, [c1.id, c2.id])
    expect(count).toBe(2)

    const rows = await listComments(ctx.db, card.id)
    const byId = new Map(rows.map(r => [r.id, r.aiStatus]))
    expect(byId.get(c1.id)).toBe('handled')
    expect(byId.get(c2.id)).toBe('handled')
    expect(await listUnhandledCommentsForProject(ctx.db, project.id)).toHaveLength(0)
  })

  it('listUnhandledCommentsForProject returns unread + read and excludes handled and AI comments', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'c' })

    const willRead = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'will be read'
    })
    const willHandle = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'will be handled'
    })

    // Advance the two existing user comments to `read`, then handle one of them.
    await listComments(ctx.db, card.id, { advanceToRead: true })
    await markCommentsHandled(ctx.db, [willHandle.id])

    // Add a fresh user comment (stays `unread`) and an AI comment (born `handled`).
    const stillUnread = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'unread one'
    })
    await addComment(ctx.db, {
      cardId: card.id,
      author: 'ai',
      bodyMd: 'ai note'
    })

    const unhandled = await listUnhandledCommentsForProject(ctx.db, project.id)
    const ids = unhandled.map(u => u.id)
    expect(ids).toContain(willRead.id)
    expect(ids).toContain(stillUnread.id)
    expect(ids).not.toContain(willHandle.id)
    expect(unhandled).toHaveLength(2)
  })

  it('listUnhandledCommentsForProject with advanceToRead moves unread → read, reflects it in the returned rows, and still returns unread + read', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'c' })

    const alreadyRead = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'already read'
    })
    // Advance this one to `read` up front, then add a fresh `unread` one.
    await listComments(ctx.db, card.id, { advanceToRead: true })
    const stillUnread = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'unread one'
    })

    const advanced = await listUnhandledCommentsForProject(ctx.db, project.id, {
      advanceToRead: true
    })
    // The advancing call returns the just-written state, not the pre-update rows.
    const byId = new Map(advanced.map(r => [r.id, r.aiStatus]))
    expect(byId.get(stillUnread.id)).toBe('read')
    expect(byId.get(alreadyRead.id)).toBe('read')
    // Still returns both (unread + read) — nothing dropped from the queue.
    expect(advanced).toHaveLength(2)

    // Persisted: both are `read` on the next read, and the scan still returns them.
    const after = await listUnhandledCommentsForProject(ctx.db, project.id)
    expect(after.map(u => u.id).sort()).toEqual([alreadyRead.id, stillUnread.id].sort())
  })

  it('listUnhandledCommentsForProject without advanceToRead leaves unread comments unread', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'c' })
    const comment = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'leave me alone'
    })

    const scanned = await listUnhandledCommentsForProject(ctx.db, project.id)
    expect(scanned.find(r => r.id === comment.id)?.aiStatus).toBe('unread')

    const rows = await listComments(ctx.db, card.id)
    expect(rows.find(r => r.id === comment.id)?.aiStatus).toBe('unread')
  })

  it('listUnhandledCommentsForProject with advanceToRead never demotes a handled comment', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'c' })
    const handled = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'handled one'
    })
    await markCommentsHandled(ctx.db, [handled.id])
    const unread = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'unread one'
    })

    // The scan never surfaces a handled comment, so it cannot demote it; the
    // unread one advances and the handled one stays handled.
    const scanned = await listUnhandledCommentsForProject(ctx.db, project.id, {
      advanceToRead: true
    })
    expect(scanned.map(u => u.id)).not.toContain(handled.id)
    expect(scanned.find(r => r.id === unread.id)?.aiStatus).toBe('read')

    const rows = await listComments(ctx.db, card.id)
    const byId = new Map(rows.map(r => [r.id, r.aiStatus]))
    expect(byId.get(handled.id)).toBe('handled')
    expect(byId.get(unread.id)).toBe('read')
  })
})
