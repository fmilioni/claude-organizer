/**
 * Embedding model registry + config resolution, in `shared` (zero-dep) so both
 * `core` (loads the model to embed) and `db` (reconciles the pgvector column to
 * the model's dimension) read the SAME source of truth.
 *
 * The model is chosen via `EMBEDDING_MODEL`; its vector dimension drives the
 * `vector(N)` column. `'none'` disables semantic search (lexical-only fallback).
 * A model outside the registry still works if the operator supplies its size via
 * `EMBEDDING_DIM` — the `e5Prefix` convention then defaults off (it is e5-only).
 */

export interface EmbeddingModelInfo {
  dim: number
  multilingual: boolean
  /** e5 models require `query:`/`passage:` prefixes; other families don't. */
  e5Prefix: boolean
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModelInfo> = {
  'intfloat/multilingual-e5-small': { dim: 384, multilingual: true, e5Prefix: true },
  'intfloat/multilingual-e5-base': { dim: 768, multilingual: true, e5Prefix: true },
  'intfloat/multilingual-e5-large': { dim: 1024, multilingual: true, e5Prefix: true }
}

export const DEFAULT_EMBEDDING_MODEL = 'intfloat/multilingual-e5-small'

/** Baseline column dimension (the default model's), used when embeddings are off. */
export const DEFAULT_EMBEDDING_DIM = EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL]!.dim

/** pgvector's hnsw/ivfflat indexes top out at 2000 dims. */
const MAX_EMBEDDING_DIM = 2000

export interface EmbeddingConfig {
  /** The model id to load, or `null` when embeddings are disabled. */
  model: string | null
  /** Vector dimension of the column (always set, even when disabled). */
  dim: number
  e5Prefix: boolean
}

type Env = Record<string, string | undefined>

// `shared` is zero-dep (no @types/node), so reach process.env via globalThis.
function readProcessEnv(): Env {
  const g = globalThis as { process?: { env?: Env } }
  return g.process?.env ?? {}
}

/**
 * Resolve the active embedding config from the environment. Throws on a bad
 * config (unknown model with no `EMBEDDING_DIM`, or an out-of-range dim) so a
 * typo fails fast and visibly instead of silently embedding into the wrong space.
 */
export function resolveEmbeddingConfig(env: Env = readProcessEnv()): EmbeddingConfig {
  const raw = env.EMBEDDING_MODEL?.trim()
  if (raw === 'none') {
    return { model: null, dim: DEFAULT_EMBEDDING_DIM, e5Prefix: false }
  }
  const model = raw || DEFAULT_EMBEDDING_MODEL
  const known = EMBEDDING_MODELS[model]
  if (known) return { model, dim: known.dim, e5Prefix: known.e5Prefix }

  const dimRaw = env.EMBEDDING_DIM?.trim()
  if (!dimRaw) {
    throw new Error(
      `Unknown EMBEDDING_MODEL "${model}". Use one of: ${Object.keys(EMBEDDING_MODELS).join(', ')}, set 'none' to disable, or provide EMBEDDING_DIM for a custom model.`
    )
  }
  const dim = Number(dimRaw)
  if (!Number.isInteger(dim) || dim < 1 || dim > MAX_EMBEDDING_DIM) {
    throw new Error(`EMBEDDING_DIM must be an integer in 1..${MAX_EMBEDDING_DIM}, got "${dimRaw}".`)
  }
  return { model, dim, e5Prefix: false }
}
