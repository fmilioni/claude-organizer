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

export const docKindEnum = pgEnum('doc_kind', [
  'module',
  'adr',
  'guide',
  'note'
])

export const repoProviderEnum = pgEnum('repo_provider', ['github', 'gitlab'])
