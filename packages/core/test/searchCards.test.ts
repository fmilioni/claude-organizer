import { describe, expect, it } from 'vitest'

import {
  addComment,
  addTagToCard,
  createCard,
  createTag,
  searchCards
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()

describe('searchCards', () => {
  it('matches by card title, ranked by relevance', async () => {
    const project = await freshProject(ctx.db)
    await createCard(ctx.db, {
      projectId: project.id,
      title: 'Implementar busca full-text',
      summary: 'tsvector e ranking'
    })
    await createCard(ctx.db, {
      projectId: project.id,
      title: 'Configurar deploy',
      summary: 'pipeline de release'
    })

    const results = await searchCards(ctx.db, project.id, 'busca')
    expect(results[0]?.title).toBe('Implementar busca full-text')
    expect(results[0]?.matchedComment).toBeNull()
  })

  it('matches a card only via its comment and returns the snippet', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Card sem o termo no corpo'
    })
    await addComment(ctx.db, {
      cardId: card!.id,
      author: 'user',
      bodyMd: 'decidimos usar pgvector como evolução futura'
    })

    const results = await searchCards(ctx.db, project.id, 'pgvector')
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe(card!.id)
    expect(results[0]?.matchedComment?.snippet).toContain('pgvector')
  })

  it('does not mark the matched comment as read', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Higiene de leitura'
    })
    await addComment(ctx.db, {
      cardId: card!.id,
      author: 'user',
      bodyMd: 'termo exclusivo zxcvbnm'
    })

    await searchCards(ctx.db, project.id, 'zxcvbnm')

    const [comment] = await ctx.db.query.comments.findMany({
      where: (c, { eq }) => eq(c.cardId, card!.id)
    })
    expect(comment?.readByAi).toBe(false)
  })

  it('finds a card by typo via trigram where tsvector alone would not', async () => {
    const project = await freshProject(ctx.db)
    await createCard(ctx.db, {
      projectId: project.id,
      title: 'Kubernetes deployment guide'
    })

    // "kubernets" is not a whole token in the title, so the `simple` tsvector
    // misses it; pg_trgm word-similarity still matches.
    const results = await searchCards(ctx.db, project.id, 'kubernets')
    expect(results.map(r => r.title)).toContain('Kubernetes deployment guide')
  })

  it('returns nothing for an empty/whitespace query', async () => {
    const project = await freshProject(ctx.db)
    await createCard(ctx.db, { projectId: project.id, title: 'qualquer card' })

    expect(await searchCards(ctx.db, project.id, '')).toEqual([])
    expect(await searchCards(ctx.db, project.id, '   ')).toEqual([])
  })

  it('restricts results with the focused-read filters (status + tag)', async () => {
    const project = await freshProject(ctx.db)
    const tag = await createTag(ctx.db, { projectId: project.id, name: 'bug' })
    const open = await createCard(ctx.db, {
      projectId: project.id,
      title: 'corrigir bug de paginação',
      status: 'in_progress'
    })
    const done = await createCard(ctx.db, {
      projectId: project.id,
      title: 'corrigir bug de cache',
      status: 'done'
    })
    await addTagToCard(ctx.db, open!.id, tag!.id)

    const active = await searchCards(ctx.db, project.id, 'corrigir', {
      activeOnly: true
    })
    expect(active.map(r => r.id)).toEqual([open!.id])

    const tagged = await searchCards(ctx.db, project.id, 'corrigir', {
      tag: 'bug'
    })
    expect(tagged.map(r => r.id)).toContain(open!.id)
    expect(tagged.map(r => r.id)).not.toContain(done!.id)
  })
})
