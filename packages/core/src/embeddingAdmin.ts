import type { Database } from '@claude-organizer/db'
import { reconcileEmbeddingDim } from '@claude-organizer/db'
import type { EmbeddingRuntimeState, EmbeddingRuntimeStatus } from '@claude-organizer/shared'
import { MCP_RUNTIME_SERVICE } from '@claude-organizer/shared'

import { getSystemSettings, setEmbeddingModel } from './authz'
import { backfillCardEmbeddings } from './cards'
import { backfillCommentEmbeddings } from './comments'
import { backfillDocEmbeddings } from './docs'
import { setEmbeddingConfig } from './embedding'
import { getRuntimeEmbeddingConfig, resolveEffectiveEmbeddingConfig } from './embeddingConfig'
import { ConflictError } from './errors'

interface ApplyProgress {
  state: Exclude<EmbeddingRuntimeState, 'idle'>
  dimChanged: boolean
  backfill: { docs: number, cards: number, comments: number }
  error: string | null
}

// Per-process: the progress of the last/ongoing apply. Null ⇒ no apply ran this
// process lifetime (idle). Ephemeral by design — a restart resets it; the backfill
// is idempotent, so a lost status never corrupts data (CO-250 decision).
let progress: ApplyProgress | null = null

function isApplying(): boolean {
  return progress?.state === 'reconciling' || progress?.state === 'backfilling'
}

/**
 * Effective embedding config (live from the DB) plus the progress of the last
 * model swap in this process. The model/dim always reflect the persisted choice,
 * so the status is correct even after a restart cleared `progress`.
 *
 * `mcpRestartRequired` is derived durably (not from the ephemeral apply flag):
 * the MCP records the model it loaded at boot, so a mismatch with the persisted
 * choice means it is still serving the old model until restarted — surfaced even
 * after the API itself restarted or the apply ran in a prior process.
 */
export async function getEmbeddingStatus(db: Database): Promise<EmbeddingRuntimeStatus> {
  const cfg = await resolveEffectiveEmbeddingConfig(db)
  const mcp = await getRuntimeEmbeddingConfig(db, MCP_RUNTIME_SERVICE)
  const mcpRestartRequired
    = mcp !== null && (mcp.model !== cfg.model || mcp.dim !== cfg.dim)
  return {
    state: progress?.state ?? 'idle',
    model: cfg.model,
    dim: cfg.dim,
    enabled: cfg.model !== null,
    dimChanged: progress?.dimChanged ?? false,
    mcpRestartRequired,
    backfill: progress?.backfill ?? { docs: 0, cards: 0, comments: 0 },
    error: progress?.error ?? null
  }
}

/**
 * Apply a model change: persist (validated) → reconcile the live pgvector dim
 * (drops vectors on a dim change) → swap this process's runtime → kick the
 * backfill in the background. The reconcile is fast (the dropped column re-indexes
 * empty), so it runs inline; only the re-embed is backgrounded. The MCP is a
 * separate process and keeps the old model until restarted — flagged in the
 * status, never silently.
 */
export async function applyEmbeddingModel(
  db: Database,
  model: string | null
): Promise<EmbeddingRuntimeStatus> {
  if (isApplying()) {
    throw new ConflictError('An embedding model change is already in progress')
  }
  // Claim the slot synchronously, before the first await — otherwise two
  // concurrent calls both pass the guard and race the persist/reconcile.
  const slot: ApplyProgress = {
    state: 'reconciling',
    dimChanged: false,
    backfill: { docs: 0, cards: 0, comments: 0 },
    error: null
  }
  progress = slot

  let prevPersisted: string | null = null
  let persisted = false
  try {
    prevPersisted = (await getSystemSettings(db)).embeddingModel
    const prev = await resolveEffectiveEmbeddingConfig(db)
    await setEmbeddingModel(db, model) // validates registry/'none'/null → InputError
    persisted = true
    const next = await resolveEffectiveEmbeddingConfig(db)
    slot.dimChanged = prev.dim !== next.dim

    await reconcileEmbeddingDim(db)
    setEmbeddingConfig(next)
  } catch (err) {
    // Restore the prior model when we'd already persisted (reconcile failed):
    // otherwise the persisted choice and the live column dim drift apart and
    // the next boot would embed the new dim into the old column. Best-effort.
    if (persisted) await setEmbeddingModel(db, prevPersisted).catch(() => {})
    progress = null
    throw err
  }

  slot.state = 'backfilling'
  void runBackfill(db, slot)
  return getEmbeddingStatus(db)
}

async function runBackfill(db: Database, p: ApplyProgress): Promise<void> {
  try {
    p.backfill.docs = await backfillDocEmbeddings(db)
    p.backfill.cards = await backfillCardEmbeddings(db)
    p.backfill.comments = await backfillCommentEmbeddings(db)
    p.state = 'done'
  } catch (err) {
    p.state = 'error'
    p.error = err instanceof Error ? err.message : String(err)
  }
}
