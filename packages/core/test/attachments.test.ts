import { describe, expect, it } from 'vitest'

import {
  addComment,
  createAttachment,
  createCard,
  deleteAttachment,
  getAttachment,
  listAttachments,
  setAttachmentOwner
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()

const png = (size = 16) => Buffer.alloc(size, 7)

const unowned = (projectId: string) =>
  createAttachment(ctx.db, {
    projectId,
    mime: 'image/png',
    data: png(),
    width: 1,
    height: 1
  })

describe('attachments CRUD', () => {
  it('creates an attachment and reads its metadata + bytes back', async () => {
    const project = await freshProject(ctx.db)
    const bytes = png(32)
    const created = await createAttachment(ctx.db, {
      projectId: project.id,
      mime: 'image/webp',
      data: bytes,
      width: 100,
      height: 80,
      filename: 'shot.webp',
      description: 'a screenshot'
    })

    expect(created.id).toMatch(/^att_/)
    expect(created.byteSize).toBe(bytes.length)
    expect(created.ownerType).toBeNull()
    expect(created).not.toHaveProperty('data')

    const fetched = await getAttachment(ctx.db, created.id)
    expect(fetched?.data).toEqual(bytes)
    expect(fetched?.mime).toBe('image/webp')
    expect(fetched?.description).toBe('a screenshot')
  })

  it('derives byteSize from the actual bytes', async () => {
    const project = await freshProject(ctx.db)
    const created = await createAttachment(ctx.db, {
      projectId: project.id,
      mime: 'image/png',
      data: png(64),
      width: 10,
      height: 10
    })
    expect(created.byteSize).toBe(64)
  })

  it('links an attachment to an owner and lists by owner', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Card'
    })
    const linked = await createAttachment(ctx.db, {
      projectId: project.id,
      mime: 'image/png',
      data: png(),
      width: 1,
      height: 1,
      owner: { ownerType: 'card', ownerId: card.id }
    })
    await createAttachment(ctx.db, {
      projectId: project.id,
      mime: 'image/png',
      data: png(),
      width: 1,
      height: 1
    })

    const all = await listAttachments(ctx.db, { projectId: project.id })
    expect(all).toHaveLength(2)

    const ofCard = await listAttachments(ctx.db, {
      projectId: project.id,
      owner: { ownerType: 'card', ownerId: card.id }
    })
    expect(ofCard.map(a => a.id)).toEqual([linked.id])
  })

  it('deletes an attachment', async () => {
    const project = await freshProject(ctx.db)
    const created = await createAttachment(ctx.db, {
      projectId: project.id,
      mime: 'image/gif',
      data: png(),
      width: 1,
      height: 1
    })
    const deleted = await deleteAttachment(ctx.db, created.id)
    expect(deleted?.id).toBe(created.id)
    expect(await getAttachment(ctx.db, created.id)).toBeNull()
  })

  it('rejects a mime outside the allow-list', async () => {
    const project = await freshProject(ctx.db)
    await expect(
      createAttachment(ctx.db, {
        projectId: project.id,
        mime: 'application/pdf' as never,
        data: png(),
        width: 1,
        height: 1
      })
    ).rejects.toThrow()
  })
})

describe('attachment owner binding (CO-269)', () => {
  it('rejects an upload owner that does not exist in the project', async () => {
    const project = await freshProject(ctx.db)
    await expect(
      createAttachment(ctx.db, {
        projectId: project.id,
        mime: 'image/png',
        data: png(),
        width: 1,
        height: 1,
        owner: { ownerType: 'card', ownerId: 'crd_doesnotexist' }
      })
    ).rejects.toThrow(/does not exist/)
  })

  it('rejects an upload owner that lives in another project', async () => {
    const a = await freshProject(ctx.db)
    const b = await freshProject(ctx.db)
    const cardB = await createCard(ctx.db, { projectId: b.id, title: 'B' })
    await expect(
      createAttachment(ctx.db, {
        projectId: a.id,
        mime: 'image/png',
        data: png(),
        width: 1,
        height: 1,
        owner: { ownerType: 'card', ownerId: cardB.id }
      })
    ).rejects.toThrow(/does not exist/)
  })

  it('binds an unowned attachment to a valid card', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'C' })
    const att = await unowned(project.id)

    const bound = await setAttachmentOwner(ctx.db, att.id, {
      ownerType: 'card',
      ownerId: card.id
    })

    expect(bound?.ownerType).toBe('card')
    expect(bound?.ownerId).toBe(card.id)
  })

  it('resolves a comment owner through its card project', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'C' })
    const comment = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'hi'
    })
    const att = await unowned(project.id)

    const bound = await setAttachmentOwner(ctx.db, att.id, {
      ownerType: 'comment',
      ownerId: comment.id
    })

    expect(bound?.ownerId).toBe(comment.id)
  })

  it('rejects re-binding an already-owned attachment', async () => {
    const project = await freshProject(ctx.db)
    const cardA = await createCard(ctx.db, { projectId: project.id, title: 'A' })
    const cardB = await createCard(ctx.db, { projectId: project.id, title: 'B' })
    const att = await unowned(project.id)
    await setAttachmentOwner(ctx.db, att.id, { ownerType: 'card', ownerId: cardA.id })

    await expect(
      setAttachmentOwner(ctx.db, att.id, { ownerType: 'card', ownerId: cardB.id })
    ).rejects.toThrow(/already has an owner/)
  })

  it('rejects binding to an owner from another project', async () => {
    const a = await freshProject(ctx.db)
    const b = await freshProject(ctx.db)
    const cardB = await createCard(ctx.db, { projectId: b.id, title: 'B' })
    const att = await unowned(a.id)

    await expect(
      setAttachmentOwner(ctx.db, att.id, { ownerType: 'card', ownerId: cardB.id })
    ).rejects.toThrow(/does not exist/)
  })

  it('returns null when binding a missing attachment', async () => {
    expect(
      await setAttachmentOwner(ctx.db, 'att_missing00000', {
        ownerType: 'card',
        ownerId: 'crd_whatever0000'
      })
    ).toBeNull()
  })
})
