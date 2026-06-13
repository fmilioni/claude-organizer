import { pgEnum } from 'drizzle-orm/pg-core'

export const sprintStatusEnum = pgEnum('sprint_status', [
  'planned',
  'active',
  'completed',
  'cancelled'
])

export const cardStatusEnum = pgEnum('card_status', [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'blocked'
])

export const commentAuthorEnum = pgEnum('comment_author', ['ai', 'user'])

export const commentAiStatusEnum = pgEnum('comment_ai_status', [
  'unread',
  'read',
  'handled'
])

export const docKindEnum = pgEnum('doc_kind', [
  'module',
  'adr',
  'guide',
  'note'
])

export const repoProviderEnum = pgEnum('repo_provider', ['github', 'gitlab'])

export const intakeStatusEnum = pgEnum('intake_status', [
  'pending',
  'planned',
  'archived'
])

export const attachmentOwnerTypeEnum = pgEnum('attachment_owner_type', [
  'card',
  'comment',
  'doc',
  'inbox'
])

export const userRoleEnum = pgEnum('user_role', ['admin', 'user'])

export const userStatusEnum = pgEnum('user_status', ['pending', 'approved'])
