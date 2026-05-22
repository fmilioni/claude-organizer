/**
 * Compile-time conformance between the Drizzle schema and the API wire types in
 * @claude-organizer/shared. If a column is added, renamed or retyped, one of the
 * asserts below stops compiling and `pnpm typecheck` fails until the matching
 * field in shared is updated. Pure types — this module emits nothing at runtime.
 */
import type { InferSelectModel } from 'drizzle-orm'

import type {
  CardCommitRow,
  CardRow,
  CardStatus,
  CommentAuthor,
  CommentRow,
  DocKind,
  DocRow,
  ProjectRow,
  RepoProvider,
  RoadmapRow,
  SprintRow,
  SprintStatus,
  TagRow
} from '@claude-organizer/shared'

import {
  cardCommits,
  cards,
  cardStatusEnum,
  commentAuthorEnum,
  comments,
  docKindEnum,
  docs,
  projects,
  repoProviderEnum,
  roadmaps,
  sprints,
  sprintStatusEnum,
  tags
} from './schema/index'

/** Drizzle row (Date columns) → its JSON wire form (ISO strings). */
type Wire<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
}

type Equal<A, B>
  = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
type Assert<T extends true> = T

/**
 * Every entry must stay `true`. A mismatch makes the corresponding `Assert`
 * fail its `extends true` constraint, breaking the build. Exported so it counts
 * as used. `bodyTsv` is a generated full-text search column, not part of the API
 * contract, so it is excluded.
 */
export type SchemaConformance = [
  Assert<Equal<CardRow, Wire<InferSelectModel<typeof cards>>>>,
  Assert<Equal<SprintRow, Wire<InferSelectModel<typeof sprints>>>>,
  Assert<Equal<CommentRow, Wire<InferSelectModel<typeof comments>>>>,
  Assert<Equal<CardCommitRow, Wire<InferSelectModel<typeof cardCommits>>>>,
  Assert<Equal<DocRow, Wire<Omit<InferSelectModel<typeof docs>, 'bodyTsv'>>>>,
  Assert<Equal<ProjectRow, Wire<InferSelectModel<typeof projects>>>>,
  Assert<Equal<TagRow, Wire<InferSelectModel<typeof tags>>>>,
  Assert<Equal<RoadmapRow, Wire<InferSelectModel<typeof roadmaps>>>>,
  Assert<Equal<CardStatus, (typeof cardStatusEnum.enumValues)[number]>>,
  Assert<Equal<SprintStatus, (typeof sprintStatusEnum.enumValues)[number]>>,
  Assert<Equal<CommentAuthor, (typeof commentAuthorEnum.enumValues)[number]>>,
  Assert<Equal<DocKind, (typeof docKindEnum.enumValues)[number]>>,
  Assert<Equal<RepoProvider, (typeof repoProviderEnum.enumValues)[number]>>
]
