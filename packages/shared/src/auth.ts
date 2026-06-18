// Minimal auth wire DTOs. The better-auth tables (user/session/account/
// verification) are NOT mirrored here or in conformance.ts — better-auth owns
// that shape. These are only the slices the web consumes. See ADR "Auth:
// e-mail+senha base + GitHub opcional".

import type { EmbeddingDtype } from './embedding'
import type { UserRole, UserStatus } from './enums'

export interface SessionUser {
  id: string
  name: string
  email: string
  image: string | null
  role: UserRole
  status: UserStatus
}

export interface AuthCapabilities {
  emailPassword: boolean
  github: boolean
  hasUsers: boolean
  // false = sem-auth mode: the web runs without sessions/gating, as before auth.
  authEnabled: boolean
  // true = preserve attached diffs when archiving a card/sprint.
  keepDiffsOnArchive: boolean
  // true = preserve attached image bytes when archiving a card/sprint.
  keepAttachmentsOnArchive: boolean
  // true (default) = include attached image bytes in a backup envelope.
  includeAttachmentsInBackup: boolean
  // true (default) = auto-hide loose done cards from the board (view only).
  hideLooseDoneEnabled: boolean
  hideLooseDoneAfterDays: number
  // Effective embedding config (persisted choice > env > default). `model: null`
  // ⇒ semantic search off (lexical-only); `dim`/`dtype` are always set.
  embedding: {
    model: string | null
    dim: number
    enabled: boolean
    dtype: EmbeddingDtype
  }
}

// A user as listed on the admin management page — every account with its
// role/status, so the UI can show badges and gate the per-row actions.
export interface AdminUser {
  id: string
  name: string
  email: string
  image: string | null
  role: UserRole
  status: UserStatus
  createdAt: string
}
