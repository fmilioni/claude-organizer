import { describe, expect, it } from 'vitest'

import { archiveDoc, createDoc, searchDocs } from '../src/index'
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

  it('recovers a doc via OR-recall when some query terms are absent', async () => {
    const project = await freshProject(ctx.db)
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Pipeline de emissão fiscal (NF-e/NFC-e)',
      bodyMd: 'gera o QR Code e o XML'
    })
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Outro assunto',
      bodyMd: 'nada a ver'
    })

    // DANFCE and PDF never appear; the old AND semantics zeroed the whole result.
    const results = await searchDocs(
      ctx.db,
      project.id,
      'NFC-e DANFCE fiscal QR Code PDF'
    )
    expect(results.map(d => d.title)).toContain(
      'Pipeline de emissão fiscal (NF-e/NFC-e)'
    )
  })

  it('keeps a full-text hit ahead of a pure trigram/typo match', async () => {
    const project = await freshProject(ctx.db)
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'deploy guide',
      bodyMd: 'conteúdo'
    })
    // "deployment" is not the token "deploy" (no stemming) and "kubernets" is a
    // typo — this doc only reaches the result via trigram, so it must rank below.
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Kubernetes deployment',
      bodyMd: 'conteúdo'
    })

    const results = await searchDocs(ctx.db, project.id, 'kubernets deploy')
    expect(results[0]?.title).toBe('deploy guide')
  })

  it('honors -exclude: keeps positives, drops docs with the negated term', async () => {
    const project = await freshProject(ctx.db)
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'alpha included',
      bodyMd: 'sem o termo proibido'
    })
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'alpha excluded',
      bodyMd: 'contém betaword aqui'
    })

    const results = await searchDocs(ctx.db, project.id, 'alpha -betaword')
    const titles = results.map(d => d.title)
    expect(titles).toContain('alpha included')
    expect(titles).not.toContain('alpha excluded')
  })

  it('matches a body substring via ILIKE when title/summary do not', async () => {
    const project = await freshProject(ctx.db)
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Notas',
      bodyMd: 'usa o operador supercalifragilistico'
    })

    const results = await searchDocs(ctx.db, project.id, 'califragili')
    expect(results.map(d => d.title)).toContain('Notas')
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

  it('excludes archived docs by default, includes them on opt-in', async () => {
    const project = await freshProject(ctx.db)
    const doc = await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Doc arquivado',
      bodyMd: 'termoraro só no corpo'
    })
    await archiveDoc(ctx.db, doc!.id)

    expect(await searchDocs(ctx.db, project.id, 'termoraro')).toHaveLength(0)
    expect(
      await searchDocs(ctx.db, project.id, 'termoraro', { includeArchived: true })
    ).toHaveLength(1)
  })
})
