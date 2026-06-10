import { describe, expect, it } from 'vitest'

import {
  createAttachment,
  createCard,
  deleteAttachment,
  getAttachment,
  listAttachments
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()

const png = (size = 16) => Buffer.alloc(size, 7)

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
