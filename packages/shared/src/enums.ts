// Canonical enum values, mirroring the Postgres pgEnums in
// @claude-organizer/db. The conformance check there asserts they stay in sync.

export const CARD_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'blocked'
] as const
export type CardStatus = (typeof CARD_STATUSES)[number]

export const SPRINT_STATUSES = [
  'planned',
  'active',
  'completed',
  'cancelled'
] as const
export type SprintStatus = (typeof SPRINT_STATUSES)[number]

export const COMMENT_AUTHORS = ['ai', 'user'] as const
export type CommentAuthor = (typeof COMMENT_AUTHORS)[number]

export const DOC_KINDS = ['module', 'adr', 'guide', 'note'] as const
export type DocKind = (typeof DOC_KINDS)[number]

export const REPO_PROVIDERS = ['github', 'gitlab'] as const
export type RepoProvider = (typeof REPO_PROVIDERS)[number]
