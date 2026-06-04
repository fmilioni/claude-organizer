import type {
  CardStatus,
  CommentAuthor,
  DocKind,
  IntakeStatus,
  RepoProvider,
  SprintStatus
} from './enums'

/*
 * Persisted-row types, in API wire form: timestamps are ISO `string`s (what the
 * REST API serializes and the UI receives), not `Date`s.
 *
 * These mirror the Drizzle schema column-for-column and are kept in lockstep by
 * a compile-time conformance check in @claude-organizer/db (src/conformance.ts):
 * adding, renaming or retyping a column there breaks `pnpm typecheck` until the
 * matching field here is updated. The DTOs below build on these rows.
 */

export interface CardRow {
  id: string
  projectId: string
  sprintId: string | null
  parentId: string | null
  key: string
  title: string
  summary: string | null
  descriptionMd: string | null
  status: CardStatus
  priority: number
  dueDate: string | null
  position: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface SprintRow {
  id: string
  projectId: string
  roadmapId: string | null
  name: string
  goal: string | null
  status: SprintStatus
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface CommentRow {
  id: string
  cardId: string
  author: CommentAuthor
  bodyMd: string
  readByAi: boolean
  createdAt: string
}

export interface CardCommitRow {
  id: string
  cardId: string
  sha: string
  message: string
  stat: string | null
  diff: string | null
  committedAt: string | null
  authorName: string | null
  createdAt: string
}

export interface DocRow {
  id: string
  projectId: string
  parentId: string | null
  title: string
  summary: string | null
  bodyMd: string | null
  kind: DocKind
  position: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface ProjectRow {
  id: string
  slug: string
  name: string
  description: string | null
  keyPrefix: string
  nextKeySeq: number
  repoProvider: RepoProvider | null
  repoWebUrl: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface TagRow {
  id: string
  projectId: string
  name: string
  color: string
  createdAt: string
}

export interface RoadmapRow {
  id: string
  projectId: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface IntakeItemRow {
  id: string
  projectId: string
  bodyMd: string
  status: IntakeStatus
  plannedCardKeys: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

/* ---- API DTOs: what the REST endpoints return and the UI consumes ---- */

export type Project = ProjectRow
export type Roadmap = RoadmapRow
export type Comment = CommentRow
export type CardCommit = CardCommitRow

/**
 * Intake item as returned by the API. `completed` is derived at read time for
 * planned items: true when ≥1 referenced card is non-archived and all
 * non-archived referenced cards are `done` (archived/destroyed cards ignored).
 */
export interface IntakeItem extends IntakeItemRow {
  completed?: boolean
}

/** Tag as embedded in cards or listed for a project (createdAt not surfaced). */
export interface Tag {
  id: string
  projectId: string
  name: string
  color: string
}

/** Sprint as returned by the API. `archivedAt` is optional: list endpoints may omit it. */
export interface Sprint extends Omit<SprintRow, 'archivedAt'> {
  archivedAt?: string | null
}

export interface CardSubtask {
  id: string
  key: string
  title: string
  status: CardStatus
  priority: number
}

export interface CardParent {
  id: string
  key: string
  title: string
  status: CardStatus
}

/**
 * Card as returned by the API. List endpoints omit `descriptionMd`/`archivedAt`;
 * detail endpoints add joins (tags, subtasks, parent, blockers). Hence those
 * fields are optional here.
 */
export interface Card extends Omit<CardRow, 'descriptionMd' | 'archivedAt'> {
  descriptionMd?: string | null
  archivedAt?: string | null
  tags?: Tag[]
  parentKey?: string | null
  subtaskCount?: number
  subtaskDone?: number
  subtasks?: CardSubtask[]
  parent?: CardParent | null
  blockedBy?: CardParent[]
  blocking?: CardParent[]
  blockedByPending?: number
}

/** Doc list item: no body, `archivedAt` optional (list endpoints omit it). */
export interface DocSummary extends Omit<DocRow, 'bodyMd' | 'archivedAt'> {
  archivedAt?: string | null
}

/** Full doc, including the markdown body. */
export interface Doc extends DocSummary {
  bodyMd: string | null
}
