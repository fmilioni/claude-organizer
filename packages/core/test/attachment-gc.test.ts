import { beforeEach, describe, expect, it } from 'vitest'

import {
  addComment,
  archiveCard,
  archiveIntakeItem,
  archiveSprint,
  createAttachment,
  createCard,
  createIntakeItem,
  createSprint,
  getAttachment,
  setKeepAttachmentsOnArchive,
  updateCard
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()

const bytes = () => Buffer.from('img', 'utf8')
const ref = (id: string) => `body ![pic](/attachments/${id}) more`

async function ownedImageCard(
  projectId: string,
  opts: { sprintId?: string } = {}
) {
  const card = await createCard(ctx.db, {
    projectId,
    sprintId: opts.sprintId,
    title: 'C'
  })
  const att = await createAttachment(ctx.db, {
    projectId,
    mime: 'image/png',
    data: bytes(),
    width: 1,
    height: 1,
    owner: { ownerType: 'card', ownerId: card.id }
  })
  await updateCard(ctx.db, { id: card.id, descriptionMd: ref(att.id) })
  return { card, att }
}

const dataOf = async (id: string) => (await getAttachment(ctx.db, id))!.data

describe('gcAttachmentsOnArchive', () => {
  beforeEach(async () => {
    await setKeepAttachmentsOnArchive(ctx.db, false)
  })

  it('clears bytes when the card owner is archived and nothing else refs it', async () => {
    const project = await freshProject(ctx.db)
    const { card, att } = await ownedImageCard(project.id)

    await archiveCard(ctx.db, card.id)

    expect(await dataOf(att.id)).toBeNull()
  })

  it('keeps bytes while an active card still refs them, clears on the last archive', async () => {
    const project = await freshProject(ctx.db)
    const { card: cardA, att } = await ownedImageCard(project.id)
    const cardB = await createCard(ctx.db, { projectId: project.id, title: 'B' })
    await updateCard(ctx.db, { id: cardB.id, descriptionMd: ref(att.id) })

    await archiveCard(ctx.db, cardA.id)
    expect(await dataOf(att.id)).not.toBeNull()

    await archiveCard(ctx.db, cardB.id)
    expect(await dataOf(att.id)).toBeNull()
  })

  it('clears a comment-owned image when its card is archived (cascade)', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'C' })
    const comment = await addComment(ctx.db, {
      cardId: card.id,
      author: 'user',
      bodyMd: 'has an image'
    })
    const att = await createAttachment(ctx.db, {
      projectId: project.id,
      mime: 'image/png',
      data: bytes(),
      width: 1,
      height: 1,
      owner: { ownerType: 'comment', ownerId: comment.id }
    })

    await archiveCard(ctx.db, card.id)

    expect(await dataOf(att.id)).toBeNull()
  })

  it('never clears when the toggle is ON', async () => {
    const project = await freshProject(ctx.db)
    const { card, att } = await ownedImageCard(project.id)

    await setKeepAttachmentsOnArchive(ctx.db, true)
    try {
      await archiveCard(ctx.db, card.id)
      expect(await dataOf(att.id)).not.toBeNull()
    } finally {
      await setKeepAttachmentsOnArchive(ctx.db, false)
    }
  })

  it('aggressively clears a sprint card image with no out-of-scope ref', async () => {
    const project = await freshProject(ctx.db)
    const sprint = await createSprint(ctx.db, { projectId: project.id, name: 'S' })
    const { att } = await ownedImageCard(project.id, { sprintId: sprint.id })

    await archiveSprint(ctx.db, sprint.id)

    expect(await dataOf(att.id)).toBeNull()
  })

  it('keeps a sprint card image still referenced by a card outside the sprint', async () => {
    const project = await freshProject(ctx.db)
    const sprint = await createSprint(ctx.db, { projectId: project.id, name: 'S' })
    const { att } = await ownedImageCard(project.id, { sprintId: sprint.id })
    const outsider = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Outsider'
    })
    await updateCard(ctx.db, { id: outsider.id, descriptionMd: ref(att.id) })

    await archiveSprint(ctx.db, sprint.id)

    expect(await dataOf(att.id)).not.toBeNull()
  })

  it('clears an inbox-owned image when the intake item is archived', async () => {
    const project = await freshProject(ctx.db)
    const item = await createIntakeItem(ctx.db, {
      projectId: project.id,
      bodyMd: 'placeholder'
    })
    const att = await createAttachment(ctx.db, {
      projectId: project.id,
      mime: 'image/png',
      data: bytes(),
      width: 1,
      height: 1,
      owner: { ownerType: 'inbox', ownerId: item.id }
    })

    await archiveIntakeItem(ctx.db, item.id)

    expect(await dataOf(att.id)).toBeNull()
  })
})
