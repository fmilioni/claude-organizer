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

export const COMMENT_AI_STATUSES = ['unread', 'read', 'handled'] as const
export type CommentAiStatus = (typeof COMMENT_AI_STATUSES)[number]

export const DOC_KINDS = ['module', 'adr', 'guide', 'note'] as const
export type DocKind = (typeof DOC_KINDS)[number]

export const REPO_PROVIDERS = ['github', 'gitlab'] as const
export type RepoProvider = (typeof REPO_PROVIDERS)[number]

export const INTAKE_STATUSES = ['pending', 'planned', 'archived'] as const
export type IntakeStatus = (typeof INTAKE_STATUSES)[number]

export const USER_ROLES = ['admin', 'user'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const USER_STATUSES = ['pending', 'approved'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

// Owner entity an attachment may be linked to. The link is optional (the
// markdown reference is the source of truth); 'inbox' maps to intake_items.
export const ATTACHMENT_OWNER_TYPES = ['card', 'comment', 'doc', 'inbox'] as const
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number]

export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
] as const
export type AttachmentMime = (typeof ATTACHMENT_MIME_TYPES)[number]
