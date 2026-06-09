import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/embedding', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/embedding')>()),
  embed: vi.fn(async () => null),
  embedMany: vi.fn(async () => null)
}))

import {
  addComment,
  backfillCardEmbeddings,
  backfillCommentEmbeddings,
  createCard,
  embed,
  searchCards,
  updateCard,
  updateComment
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()
const mockedEmbed = vi.mocked(embed)

function basis(axis: number): number[] {
  const v = Array(384).fill(0)
  v[axis] = 1
  return v
}

function vecLiteral(axis: number): string {
  return `[${basis(axis).join(',')}]`
}

async function seedCard(id: string, axis: number) {
  await ctx.db.execute(
    sql`update cards set embedding = ${vecLiteral(axis)}::vector where id = ${id}`
  )
}

async function seedComment(id: string, axis: number) {
  await ctx.db.execute(
    sql`update comments set embedding = ${vecLiteral(axis)}::vector where id = ${id}`
  )
}

beforeEach(() => {
  mockedEmbed.mockReset()
  mockedEmbed.mockResolvedValue(null) // default: writes store null; search falls back to lexical
})

describe('cards semantic search', () => {
  it('recovers a card with no lexical overlap via the card vector', async () => {
    const project = await freshProject(ctx.db)
    const fiscal = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Pipeline de emissão fiscal NFC-e'
    })
    const other = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Arquitetura do monorepo'
    })
    await seedCard(fiscal!.id, 0)
    await seedCard(other!.id, 1)

    mockedEmbed.mockResolvedValueOnce(basis(0))
    const results = await searchCards(ctx.db, project.id, 'DANFCE PDF')
    expect(results.map(r => r.id)).toContain(fiscal!.id)
    expect(results[0]?.id).toBe(fiscal!.id)
  })

  it('recovers a card via a comment vector and returns the comment snippet', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Card neutro'
    })
    const comment = await addComment(ctx.db, {
      cardId: card!.id,
      author: 'user',
      bodyMd: 'decidimos usar pgvector como evolução'
    })
    // Card has no embedding; only the comment is seeded near the query.
    await seedComment(comment!.id, 0)

    mockedEmbed.mockResolvedValueOnce(basis(0))
    const results = await searchCards(ctx.db, project.id, 'busca vetorial')
    expect(results.map(r => r.id)).toContain(card!.id)
    const hit = results.find(r => r.id === card!.id)
    expect(hit?.matchedComment).not.toBeNull()
    expect(hit?.matchedComment?.snippet).toMatch(/pgvector|decidimos|usar/i)
  })

  it('keeps an exact lexical hit on top after fusion (no regression)', async () => {
    const project = await freshProject(ctx.db)
    const fiscal = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Pipeline de emissão fiscal'
    })
    const arch = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Arquitetura do monorepo'
    })
    await seedCard(fiscal!.id, 0)
    await seedCard(arch!.id, 1)

    mockedEmbed.mockResolvedValueOnce(basis(0))
    const results = await searchCards(ctx.db, project.id, 'Arquitetura')
    expect(results[0]?.id).toBe(arch!.id)
  })

  it('falls back to lexical-only when the query cannot be embedded', async () => {
    const project = await freshProject(ctx.db)
    const arch = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Arquitetura do monorepo'
    })
    await seedCard(arch!.id, 1)

    const results = await searchCards(ctx.db, project.id, 'Arquitetura')
    expect(results.map(r => r.id)).toEqual([arch!.id])
  })

  it('embeds the card (key+title+summary+description) as a passage on create', async () => {
    const project = await freshProject(ctx.db)
    await createCard(ctx.db, {
      projectId: project.id,
      title: 'Título do card',
      summary: 'resumo',
      descriptionMd: 'descrição'
    })
    expect(mockedEmbed).toHaveBeenCalledWith(
      expect.stringContaining('Título do card\nresumo\ndescrição'),
      'passage'
    )
  })

  it('embeds a comment body as a passage on create', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'C' })
    mockedEmbed.mockClear()
    await addComment(ctx.db, {
      cardId: card!.id,
      author: 'user',
      bodyMd: 'corpo do comentário'
    })
    expect(mockedEmbed).toHaveBeenCalledWith('corpo do comentário', 'passage')
  })

  it('re-embeds a card on a content edit but not on a metadata-only edit', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Original'
    })
    mockedEmbed.mockClear()

    await updateCard(ctx.db, { id: card!.id, position: 2 })
    expect(mockedEmbed).not.toHaveBeenCalled()

    await updateCard(ctx.db, { id: card!.id, title: 'Editado' })
    expect(mockedEmbed).toHaveBeenCalledTimes(1)
  })

  it('re-embeds a comment on body edit', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'C' })
    const comment = await addComment(ctx.db, {
      cardId: card!.id,
      author: 'user',
      bodyMd: 'corpo inicial'
    })
    mockedEmbed.mockClear()

    await updateComment(ctx.db, { id: comment!.id, bodyMd: 'corpo editado' })
    expect(mockedEmbed).toHaveBeenCalledWith('corpo editado', 'passage')
  })

  it('backfills embeddings for cards and comments missing one', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'sem vetor' })
    const comment = await addComment(ctx.db, {
      cardId: card!.id,
      author: 'user',
      bodyMd: 'comentário sem vetor'
    })

    mockedEmbed.mockResolvedValue(basis(0))
    const cards = await backfillCardEmbeddings(ctx.db, 10)
    const comments = await backfillCommentEmbeddings(ctx.db, 10)
    expect(cards).toBeGreaterThanOrEqual(1)
    expect(comments).toBeGreaterThanOrEqual(1)

    const cardRow = (await ctx.db.execute(
      sql`select embedding from cards where id = ${card!.id}`
    )) as unknown as Array<{ embedding: string | null }>
    const commentRow = (await ctx.db.execute(
      sql`select embedding from comments where id = ${comment!.id}`
    )) as unknown as Array<{ embedding: string | null }>
    expect(cardRow[0]?.embedding).not.toBeNull()
    expect(commentRow[0]?.embedding).not.toBeNull()
  })
})
