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
    expect(comment?.aiStatus).toBe('unread')
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

  it('recovers a card via OR-recall when some query terms are absent', async () => {
    const project = await freshProject(ctx.db)
    const target = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Pipeline de emissão fiscal NFC-e',
      summary: 'gera o QR Code'
    })
    await createCard(ctx.db, {
      projectId: project.id,
      title: 'Tarefa sem relação',
      summary: 'outro tema'
    })

    const results = await searchCards(
      ctx.db,
      project.id,
      'NFC-e DANFCE fiscal QR Code PDF'
    )
    expect(results.map(r => r.id)).toContain(target!.id)
  })

  it('matches a card by comment via OR-recall when some terms are absent', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Card neutro'
    })
    await addComment(ctx.db, {
      cardId: card!.id,
      author: 'user',
      bodyMd: 'decidimos emitir o QR Code fiscal'
    })

    const results = await searchCards(
      ctx.db,
      project.id,
      'NFC-e DANFCE fiscal QR Code PDF'
    )
    expect(results.map(r => r.id)).toContain(card!.id)
    expect(
      results.find(r => r.id === card!.id)?.matchedComment?.snippet
    ).toMatch(/QR|Code|fiscal/i)
  })

  it('keeps a full-text hit ahead of a pure trigram/typo match', async () => {
    const project = await freshProject(ctx.db)
    await createCard(ctx.db, { projectId: project.id, title: 'deploy guide' })
    // Only reachable via trigram ("kubernets" typo, "deployment" ≠ "deploy"):
    // under the old recall-first rank its high word_similarity beat the real
    // full-text hit; standardized rank now puts the full-text hit first.
    await createCard(ctx.db, {
      projectId: project.id,
      title: 'Kubernetes deployment'
    })

    const results = await searchCards(ctx.db, project.id, 'kubernets deploy')
    expect(results[0]?.title).toBe('deploy guide')
  })

  it('honors -exclude: keeps positives, drops cards with the negated term', async () => {
    const project = await freshProject(ctx.db)
    await createCard(ctx.db, { projectId: project.id, title: 'alpha included' })
    await createCard(ctx.db, {
      projectId: project.id,
      title: 'alpha excluded',
      descriptionMd: 'contém betaword'
    })

    const results = await searchCards(ctx.db, project.id, 'alpha -betaword')
    const titles = results.map(r => r.title)
    expect(titles).toContain('alpha included')
    expect(titles).not.toContain('alpha excluded')
  })

  it('matches a description substring via ILIKE when title/summary do not', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Card genérico',
      descriptionMd: 'usa o operador supercalifragilistico'
    })

    const results = await searchCards(ctx.db, project.id, 'califragili')
    expect(results.map(r => r.id)).toContain(card!.id)
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
