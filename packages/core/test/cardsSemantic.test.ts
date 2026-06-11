import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/embedding', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/embedding')>()),
  embed: vi.fn(async () => null),
  embedMany: vi.fn(async () => null),
  embedChunks: vi.fn(async () => null)
}))

import {
  addComment,
  backfillCardEmbeddings,
  backfillCommentEmbeddings,
  createCard,
  embed,
  embedChunks,
  searchCards,
  updateCard,
  updateComment
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()
const mockedEmbed = vi.mocked(embed)
const mockedEmbedChunks = vi.mocked(embedChunks)

function basis(axis: number): number[] {
  const v = Array(384).fill(0)
  v[axis] = 1
  return v
}

function vecLiteral(axis: number): string {
  return `[${basis(axis).join(',')}]`
}

// Seed a single chunk vector for a card / comment (search reads the chunk tables now).
async function seedCard(id: string, axis: number) {
  await ctx.db.execute(
    sql`insert into card_chunks (card_id, idx, embedding) values (${id}, 0, ${vecLiteral(axis)}::vector)`
  )
}

async function seedComment(id: string, axis: number) {
  await ctx.db.execute(
    sql`insert into comment_chunks (comment_id, idx, embedding) values (${id}, 0, ${vecLiteral(axis)}::vector)`
  )
}

async function rowCount(table: string, col: string, id: string): Promise<number> {
  const rows = (await ctx.db.execute(
    sql`select count(*)::int as n from ${sql.raw(table)} where ${sql.raw(col)} = ${id}`
  )) as unknown as Array<{ n: number }>
  return rows[0]?.n ?? 0
}

beforeEach(() => {
  mockedEmbed.mockReset()
  mockedEmbed.mockResolvedValue(null) // default: search query falls back to lexical
  mockedEmbedChunks.mockReset()
  mockedEmbedChunks.mockResolvedValue(null) // default: writes store no chunks
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

  it('finds a card via a non-first (tail) chunk — the part a single vector truncated', async () => {
    const project = await freshProject(ctx.db)
    const long = await createCard(ctx.db, { projectId: project.id, title: 'longo' })
    const other = await createCard(ctx.db, { projectId: project.id, title: 'outro' })
    await ctx.db.execute(sql`insert into card_chunks (card_id, idx, embedding) values
      (${long!.id}, 0, ${vecLiteral(0)}::vector), (${long!.id}, 1, ${vecLiteral(1)}::vector)`)
    await seedCard(other!.id, 2)

    // The query lands on axis 1 — only the TAIL chunk of `long` is near it.
    mockedEmbed.mockResolvedValueOnce(basis(1))
    const results = await searchCards(ctx.db, project.id, 'DANFCE PDF')
    expect(results.map(r => r.id)).toContain(long!.id)
    expect(results[0]?.id).toBe(long!.id)
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

  it('chunks the card (key+title+summary+description) as a passage on create', async () => {
    mockedEmbedChunks.mockResolvedValue([basis(0)])
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Título do card',
      summary: 'resumo',
      descriptionMd: 'descrição'
    })
    expect(mockedEmbedChunks).toHaveBeenCalledWith(
      expect.stringContaining('Título do card\nresumo\ndescrição')
    )
    expect(await rowCount('card_chunks', 'card_id', card!.id)).toBe(1)
  })

  it('chunks a comment body as a passage on create', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'C' })
    mockedEmbedChunks.mockClear()
    mockedEmbedChunks.mockResolvedValue([basis(0)])
    const comment = await addComment(ctx.db, {
      cardId: card!.id,
      author: 'user',
      bodyMd: 'corpo do comentário'
    })
    expect(mockedEmbedChunks).toHaveBeenCalledWith('corpo do comentário')
    expect(await rowCount('comment_chunks', 'comment_id', comment!.id)).toBe(1)
  })

  it('re-chunks a card on a content edit but not on a metadata-only edit', async () => {
    mockedEmbedChunks.mockResolvedValue([basis(0)])
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Original'
    })
    mockedEmbedChunks.mockClear()

    await updateCard(ctx.db, { id: card!.id, position: 2 })
    expect(mockedEmbedChunks).not.toHaveBeenCalled()

    await updateCard(ctx.db, { id: card!.id, title: 'Editado' })
    expect(mockedEmbedChunks).toHaveBeenCalledTimes(1)
  })

  it('re-chunks a comment on body edit', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'C' })
    const comment = await addComment(ctx.db, {
      cardId: card!.id,
      author: 'user',
      bodyMd: 'corpo inicial'
    })
    mockedEmbedChunks.mockClear()
    mockedEmbedChunks.mockResolvedValue([basis(0)])

    await updateComment(ctx.db, { id: comment!.id, bodyMd: 'corpo editado' })
    expect(mockedEmbedChunks).toHaveBeenCalledWith('corpo editado')
    expect(await rowCount('comment_chunks', 'comment_id', comment!.id)).toBe(1)
  })

  it('backfills chunks for cards and comments missing them, idempotently', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'sem vetor' })
    const comment = await addComment(ctx.db, {
      cardId: card!.id,
      author: 'user',
      bodyMd: 'comentário sem vetor'
    })

    mockedEmbedChunks.mockResolvedValue([basis(0)])
    const cards = await backfillCardEmbeddings(ctx.db, 10)
    const comments = await backfillCommentEmbeddings(ctx.db, 10)
    expect(cards).toBeGreaterThanOrEqual(1)
    expect(comments).toBeGreaterThanOrEqual(1)
    expect(await rowCount('card_chunks', 'card_id', card!.id)).toBe(1)
    expect(await rowCount('comment_chunks', 'comment_id', comment!.id)).toBe(1)

    // Idempotent: a second run leaves the already-chunked entities at one row each
    // (excluded by `not exists`) — no duplicates. (The backfill is global, so its
    // return count isn't asserted in the shared test DB.)
    await backfillCardEmbeddings(ctx.db, 10)
    await backfillCommentEmbeddings(ctx.db, 10)
    expect(await rowCount('card_chunks', 'card_id', card!.id)).toBe(1)
    expect(await rowCount('comment_chunks', 'comment_id', comment!.id)).toBe(1)
  })

  it('backfill terminates on whitespace-only content (keyset cursor, no infinite loop)', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, { projectId: project.id, title: 'C' })
    // Whitespace-only body passes min(1) but chunks to nothing → stores no row.
    const blank = await addComment(ctx.db, { cardId: card!.id, author: 'user', bodyMd: '   ' })
    const real = await addComment(ctx.db, { cardId: card!.id, author: 'user', bodyMd: 'conteúdo real' })

    mockedEmbedChunks.mockImplementation(async t => (t.trim() ? [basis(0)] : []))
    // batchSize 1 would re-fetch the blank row forever without the keyset cursor.
    await backfillCommentEmbeddings(ctx.db, 1)

    expect(await rowCount('comment_chunks', 'comment_id', blank!.id)).toBe(0)
    expect(await rowCount('comment_chunks', 'comment_id', real!.id)).toBe(1)
  })
})
