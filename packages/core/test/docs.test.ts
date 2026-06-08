import { describe, expect, it } from 'vitest'

import { createDoc, searchDocs } from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()

describe('docs full-text search', () => {
  it('ranks the doc whose body matches the query at the top', async () => {
    const project = await freshProject(ctx.db)
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Arquitetura',
      bodyMd: 'diagrama de componentes e camadas'
    })
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Modelo de dados',
      bodyMd: 'tabelas, colunas e relacionamentos no Postgres'
    })

    const results = await searchDocs(ctx.db, project.id, 'tabelas')
    expect(results[0]?.title).toBe('Modelo de dados')
  })

  it('matches a title substring via ILIKE even when FTS tokens do not', async () => {
    const project = await freshProject(ctx.db)
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Arquitetura',
      bodyMd: 'conteúdo'
    })

    const results = await searchDocs(ctx.db, project.id, 'Arqu')
    expect(results.map(d => d.title)).toContain('Arquitetura')
  })

  it('matches a title typo via pg_trgm where FTS and ILIKE would not', async () => {
    const project = await freshProject(ctx.db)
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Kubernetes deployment',
      bodyMd: 'conteúdo'
    })

    // "kubernets" is neither a whole token (FTS) nor a substring (ILIKE) of the
    // title; only trigram word-similarity finds it.
    const results = await searchDocs(ctx.db, project.id, 'kubernets')
    expect(results.map(d => d.title)).toContain('Kubernetes deployment')
  })

  it('returns nothing for an empty/whitespace query', async () => {
    const project = await freshProject(ctx.db)
    await createDoc(ctx.db, { projectId: project.id, title: 'qualquer doc' })

    expect(await searchDocs(ctx.db, project.id, '')).toEqual([])
    expect(await searchDocs(ctx.db, project.id, '   ')).toEqual([])
  })

  it('scopes results to the given project', async () => {
    const p1 = await freshProject(ctx.db)
    const p2 = await freshProject(ctx.db)
    await createDoc(ctx.db, {
      projectId: p1.id,
      title: 'Somente no P1',
      bodyMd: 'palavrachave exclusiva'
    })

    expect(await searchDocs(ctx.db, p2.id, 'palavrachave')).toHaveLength(0)
    expect(await searchDocs(ctx.db, p1.id, 'palavrachave')).toHaveLength(1)
  })
})
