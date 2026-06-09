import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { resolveEmbeddingConfig } from '@claude-organizer/shared'

import { reciprocalRankFusion } from '../src/index'
import { useTestDb } from './helpers'

const ctx = useTestDb()

describe('pgvector foundation', () => {
  it('has the vector extension enabled', async () => {
    const rows = (await ctx.db.execute(
      sql`select extname from pg_extension where extname = 'vector'`
    )) as unknown as Array<{ extname: string }>
    expect(rows.map(r => r.extname)).toContain('vector')
  })

  it('has an embedding vector(384) column on docs, cards and comments', async () => {
    for (const table of ['docs', 'cards', 'comments']) {
      const rows = (await ctx.db.execute(sql`
        select a.atttypmod as typmod
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        where c.relname = ${table}
          and a.attname = 'embedding'
          and n.nspname = current_schema()
          and a.attnum > 0 and not a.attisdropped
      `)) as unknown as Array<{ typmod: number }>
      expect(rows[0]?.typmod, `${table}.embedding dimension`).toBe(384)
    }
  })

  it('has an hnsw index on each embedding column', async () => {
    const rows = (await ctx.db.execute(sql`
      select indexname from pg_indexes
      where indexname in ('docs_embedding_idx', 'cards_embedding_idx', 'comments_embedding_idx')
    `)) as unknown as Array<{ indexname: string }>
    expect(rows.map(r => r.indexname).sort()).toEqual([
      'cards_embedding_idx',
      'comments_embedding_idx',
      'docs_embedding_idx'
    ])
  })
})

describe('resolveEmbeddingConfig precedence', () => {
  it('a persisted override wins over EMBEDDING_MODEL', () => {
    const cfg = resolveEmbeddingConfig(
      { EMBEDDING_MODEL: 'intfloat/multilingual-e5-small' },
      'intfloat/multilingual-e5-large'
    )
    expect(cfg).toMatchObject({ model: 'intfloat/multilingual-e5-large', dim: 1024 })
  })

  it('falls back to env when the override is null/empty', () => {
    expect(resolveEmbeddingConfig({ EMBEDDING_MODEL: 'intfloat/multilingual-e5-base' }, null))
      .toMatchObject({ model: 'intfloat/multilingual-e5-base', dim: 768 })
    expect(resolveEmbeddingConfig({ EMBEDDING_MODEL: 'intfloat/multilingual-e5-base' }, '  '))
      .toMatchObject({ model: 'intfloat/multilingual-e5-base', dim: 768 })
  })

  it('a persisted "none" disables embeddings even when env sets a model', () => {
    const cfg = resolveEmbeddingConfig({ EMBEDDING_MODEL: 'intfloat/multilingual-e5-base' }, 'none')
    expect(cfg.model).toBeNull()
    expect(cfg.dim).toBe(384)
  })

  it('falls back to the default model when neither override nor env is set', () => {
    expect(resolveEmbeddingConfig({})).toMatchObject({
      model: 'intfloat/multilingual-e5-small',
      dim: 384
    })
  })
})

describe('reciprocalRankFusion', () => {
  it('ranks an id that tops both lists first', () => {
    const fused = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['a', 'c', 'd']
    ])
    expect(fused[0]!.id).toBe('a')
  })

  it('includes ids present in only one list', () => {
    const fused = reciprocalRankFusion([['x'], ['y']])
    expect(fused.map(f => f.id).sort()).toEqual(['x', 'y'])
  })

  it('rewards a higher rank (smaller index) with a higher score', () => {
    const [first] = reciprocalRankFusion([['top', 'second']])
    const scores = new Map(reciprocalRankFusion([['top', 'second']]).map(f => [f.id, f.score]))
    expect(first!.id).toBe('top')
    expect(scores.get('top')!).toBeGreaterThan(scores.get('second')!)
  })

  it('returns an empty ranking for no lists', () => {
    expect(reciprocalRankFusion([])).toEqual([])
  })
})
