import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/embedding', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/embedding')>()),
  embed: vi.fn(async () => null),
  embedMany: vi.fn(async () => null)
}))

import {
  backfillDocEmbeddings,
  createDoc,
  embed,
  searchDocs,
  updateDoc
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()
const mockedEmbed = vi.mocked(embed)

// A 384-dim (the column dimension) unit basis vector — one concept per axis, so
// cosine distance is 0 to itself and 1 to any other basis. Lets a test place docs
// and a query in a controlled vector space without loading the real model.
function basis(axis: number): number[] {
  const v = Array(384).fill(0)
  v[axis] = 1
  return v
}

function vecLiteral(axis: number): string {
  return `[${basis(axis).join(',')}]`
}

async function seedEmbedding(id: string, axis: number) {
  await ctx.db.execute(
    sql`update docs set embedding = ${vecLiteral(axis)}::vector where id = ${id}`
  )
}

beforeEach(() => {
  mockedEmbed.mockReset()
  mockedEmbed.mockResolvedValue(null) // default: writes store null; search falls back to lexical
})

describe('docs semantic search', () => {
  it('recovers a doc with no lexical overlap via the vector signal', async () => {
    const project = await freshProject(ctx.db)
    const fiscal = await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Pipeline de emissão fiscal NFC-e',
      bodyMd: 'gera o QR Code e o XML'
    })
    const other = await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Arquitetura do monorepo',
      bodyMd: 'camadas e pacotes'
    })
    await seedEmbedding(fiscal!.id, 0)
    await seedEmbedding(other!.id, 1)

    // "DANFCE PDF" shares no token with either doc — lexical recall is empty;
    // only the vector signal (query embedded near the fiscal doc) recovers it.
    mockedEmbed.mockResolvedValueOnce(basis(0))
    const results = await searchDocs(ctx.db, project.id, 'DANFCE PDF')
    expect(results.map(d => d.id)).toContain(fiscal!.id)
    expect(results[0]?.id).toBe(fiscal!.id)
  })

  it('keeps an exact lexical hit on top after fusion (no regression)', async () => {
    const project = await freshProject(ctx.db)
    const fiscal = await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Pipeline de emissão fiscal',
      bodyMd: 'conteúdo'
    })
    const arch = await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Arquitetura do monorepo',
      bodyMd: 'conteúdo'
    })
    await seedEmbedding(fiscal!.id, 0)
    await seedEmbedding(arch!.id, 1)

    // Query matches "Arquitetura" lexically, but is embedded near the fiscal doc.
    // RRF must still rank the lexical hit first (lexical rank + vector rank beats
    // a vector-only hit).
    mockedEmbed.mockResolvedValueOnce(basis(0))
    const results = await searchDocs(ctx.db, project.id, 'Arquitetura')
    expect(results[0]?.id).toBe(arch!.id)
  })

  it('falls back to lexical-only when the query cannot be embedded', async () => {
    const project = await freshProject(ctx.db)
    const arch = await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Arquitetura do monorepo',
      bodyMd: 'conteúdo'
    })
    await seedEmbedding(arch!.id, 1)

    // embed() returns null (default) — no vector branch, pure lexical.
    const results = await searchDocs(ctx.db, project.id, 'Arquitetura')
    expect(results.map(d => d.id)).toEqual([arch!.id])
  })

  it('embeds title+summary+body as a passage on create', async () => {
    const project = await freshProject(ctx.db)
    await createDoc(ctx.db, {
      projectId: project.id,
      title: 'T',
      summary: 'S',
      bodyMd: 'B'
    })
    expect(mockedEmbed).toHaveBeenCalledWith('T\nS\nB', 'passage')
  })

  it('re-embeds on a content edit but not on a metadata-only edit', async () => {
    const project = await freshProject(ctx.db)
    const doc = await createDoc(ctx.db, {
      projectId: project.id,
      title: 'Original',
      bodyMd: 'corpo'
    })
    mockedEmbed.mockClear()

    await updateDoc(ctx.db, { id: doc!.id, position: 3 })
    expect(mockedEmbed).not.toHaveBeenCalled()

    await updateDoc(ctx.db, { id: doc!.id, title: 'Editado' })
    expect(mockedEmbed).toHaveBeenCalledTimes(1)
  })

  it('backfills embeddings for docs missing one', async () => {
    const project = await freshProject(ctx.db)
    const doc = await createDoc(ctx.db, {
      projectId: project.id,
      title: 'sem vetor',
      bodyMd: 'corpo'
    })
    // created under the null mock -> embedding is null
    const before = (await ctx.db.execute(
      sql`select embedding from docs where id = ${doc!.id}`
    )) as unknown as Array<{ embedding: string | null }>
    expect(before[0]?.embedding).toBeNull()

    mockedEmbed.mockResolvedValue(basis(0))
    const count = await backfillDocEmbeddings(ctx.db, 10)
    expect(count).toBeGreaterThanOrEqual(1)

    const after = (await ctx.db.execute(
      sql`select embedding from docs where id = ${doc!.id}`
    )) as unknown as Array<{ embedding: string | null }>
    expect(after[0]?.embedding).not.toBeNull()
  })
})
