import { resolveEmbeddingConfig } from '@claude-organizer/shared'

export type EmbeddingKind = 'query' | 'passage'

interface Embedder {
  run: (texts: string[]) => Promise<number[][]>
  e5Prefix: boolean
}

let cached: Embedder | null = null
let loading: Promise<Embedder | null> | null = null

/**
 * Load the feature-extraction pipeline once per process. The transformers lib
 * (and its onnxruntime backend) is imported dynamically, so a deployment with
 * embeddings disabled (`EMBEDDING_MODEL=none`) never pays its load cost. A load
 * failure is logged and degrades to `null` (lexical-only); it isn't cached, so a
 * transient failure can recover on a later call.
 */
async function loadEmbedder(): Promise<Embedder | null> {
  const cfg = resolveEmbeddingConfig()
  if (!cfg.model) return null
  const { pipeline } = await import('@huggingface/transformers')
  // fp32 is the variant present in the default model's repo; override with a
  // quantized one (q8/int8…) via EMBEDDING_DTYPE when the repo ships it.
  const dtype = process.env.EMBEDDING_DTYPE?.trim() || 'fp32'
  const pipe = await pipeline('feature-extraction', cfg.model, {
    dtype
  } as Record<string, unknown>)
  return {
    e5Prefix: cfg.e5Prefix,
    run: async (texts) => {
      const out = await pipe(texts, { pooling: 'mean', normalize: true })
      return out.tolist() as number[][]
    }
  }
}

function getEmbedder(): Promise<Embedder | null> {
  if (cached) return Promise.resolve(cached)
  if (!loading) {
    loading = loadEmbedder()
      .then((e) => {
        cached = e
        loading = null
        return e
      })
      .catch((err) => {
        loading = null
        console.error('[embedding] model load failed; semantic search off this process', err)
        return null
      })
  }
  return loading
}

function applyPrefix(text: string, kind: EmbeddingKind, e5Prefix: boolean): string {
  // e5 models are trained with `query:`/`passage:` prefixes; other families take
  // the raw text.
  return e5Prefix ? `${kind}: ${text}` : text
}

/**
 * Embed many texts in one pass (the e5 prefix is applied per `kind`). Returns the
 * unit-normalized vectors, or `null` when embeddings are disabled/unavailable so
 * callers fall back to lexical search.
 */
export async function embedMany(
  texts: string[],
  kind: EmbeddingKind
): Promise<number[][] | null> {
  if (texts.length === 0) return []
  const embedder = await getEmbedder()
  if (!embedder) return null
  try {
    return await embedder.run(texts.map(t => applyPrefix(t, kind, embedder.e5Prefix)))
  } catch (err) {
    console.error('[embedding] inference failed; falling back to lexical', err)
    return null
  }
}

/** Embed a single text; `null` when embeddings are disabled/unavailable. */
export async function embed(
  text: string,
  kind: EmbeddingKind
): Promise<number[] | null> {
  const vectors = await embedMany([text], kind)
  return vectors ? (vectors[0] ?? null) : null
}

/**
 * Generic embedding backfill loop shared by the docs/cards/comments verticals.
 * Pulls batches of `{ id, text }` still missing an embedding, embeds each
 * (`passage`), and stores it. Idempotent; stops early (returning the count so
 * far) the moment an embed yields `null` — embeddings are disabled/unavailable,
 * so there's no point scanning the rest. The caller supplies the table-specific
 * fetch (mapping its rows to id + content text) and store.
 */
export async function backfillEmbeddings(
  batchSize: number,
  fetchBatch: (limit: number) => Promise<Array<{ id: string, text: string }>>,
  embedOne: (text: string) => Promise<number[] | null>,
  store: (id: string, embedding: number[]) => Promise<unknown>
): Promise<number> {
  let total = 0
  for (;;) {
    const rows = await fetchBatch(batchSize)
    if (rows.length === 0) break
    for (const row of rows) {
      const embedding = await embedOne(row.text)
      if (!embedding) return total
      await store(row.id, embedding)
      total++
    }
    if (rows.length < batchSize) break
  }
  return total
}
