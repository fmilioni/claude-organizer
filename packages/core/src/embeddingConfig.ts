import type { Database } from '@claude-organizer/db'
import type { EmbeddingConfig } from '@claude-organizer/shared'
import { resolveEmbeddingConfig } from '@claude-organizer/shared'

import { getSystemSettings } from './authz'
import { setEmbeddingConfig } from './embedding'

/**
 * The embedding config the process should run with: the persisted DB choice wins
 * over `EMBEDDING_MODEL`, which wins over the default. `embed()` is process-global
 * and has no db handle, so this is resolved with a db at boot/apply and pushed
 * into the runtime via `setEmbeddingConfig` — it can't be read lazily per call.
 */
export async function resolveEffectiveEmbeddingConfig(
  db: Database
): Promise<EmbeddingConfig> {
  const { embeddingModel } = await getSystemSettings(db)
  return resolveEmbeddingConfig(undefined, embeddingModel)
}

/** Prime the process embedding runtime from the DB. Call once at boot. */
export async function primeEmbeddingRuntime(db: Database): Promise<EmbeddingConfig> {
  const cfg = await resolveEffectiveEmbeddingConfig(db)
  setEmbeddingConfig(cfg)
  return cfg
}
