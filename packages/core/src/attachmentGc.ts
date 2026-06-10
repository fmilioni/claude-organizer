import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql
} from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

import { type Database, schema } from '@claude-organizer/db'

import { attachmentIdsInBody } from './attachments'
import { getSystemSettings } from './authz'

// Entities entering an archive/destroy scope by one operation. For archive the
// sprint case passes its cards even though their `archivedAt` stays null (the
// aggressive "free the bytes of this dormant sprint" drop), so scope membership
// — not `archivedAt` — is what marks an owner archived and a reference inert.
// For destroy the scope entities are about to be deleted; the same membership
// excludes them from the active-reference guard.
interface GcScope {
  projectId: string
  cardIds?: string[]
  docIds?: string[]
  intakeIds?: string[]
}

interface Candidate {
  id: string
  ownerType: string | null
  ownerId: string | null
  hasData: boolean
}

interface CandidateCollection {
  candidates: Candidate[]
  commentIds: Set<string>
}

const uniq = (ids: Array<string | null>): string[] =>
  [...new Set(ids.filter((id): id is string => id != null))]

const hasAttToken = (col: PgColumn) =>
  sql`strpos(coalesce(${col}, ''), 'att_') > 0`

// Gathers the attachments a scope could clean: those owned by a scope entity
// (card/comment/doc/inbox) plus those merely referenced in a scope body. Shared
// by both GCs — the behavioural fork is downstream (which owners count eligible,
// and clear-bytes vs delete-row). A comment has no independent lifecycle, so the
// scope's cards drag in their comments (owners and reference sources alike).
// `hasData` is a cheap boolean (no bytea on the wire) the archive path uses to
// skip already-cleared rows; destroy ignores it.
async function collectCandidates(
  db: Database,
  scope: GcScope
): Promise<CandidateCollection> {
  const cardIds = scope.cardIds ?? []
  const docIds = scope.docIds ?? []
  const intakeIds = scope.intakeIds ?? []

  const scopeComments = cardIds.length
    ? await db
        .select({ id: schema.comments.id, bodyMd: schema.comments.bodyMd })
        .from(schema.comments)
        .where(inArray(schema.comments.cardId, cardIds))
    : []
  const commentIds = new Set(scopeComments.map(c => c.id))

  const scopeCards = cardIds.length
    ? await db
        .select({ descriptionMd: schema.cards.descriptionMd })
        .from(schema.cards)
        .where(inArray(schema.cards.id, cardIds))
    : []
  const scopeDocs = docIds.length
    ? await db
        .select({ bodyMd: schema.docs.bodyMd })
        .from(schema.docs)
        .where(inArray(schema.docs.id, docIds))
    : []
  const scopeIntake = intakeIds.length
    ? await db
        .select({ bodyMd: schema.intakeItems.bodyMd })
        .from(schema.intakeItems)
        .where(inArray(schema.intakeItems.id, intakeIds))
    : []

  const referencedIds = new Set<string>()
  for (const c of scopeCards)
    for (const id of attachmentIdsInBody(c.descriptionMd)) referencedIds.add(id)
  for (const c of scopeComments)
    for (const id of attachmentIdsInBody(c.bodyMd)) referencedIds.add(id)
  for (const d of scopeDocs)
    for (const id of attachmentIdsInBody(d.bodyMd)) referencedIds.add(id)
  for (const it of scopeIntake)
    for (const id of attachmentIdsInBody(it.bodyMd)) referencedIds.add(id)

  const ownerConds = []
  if (cardIds.length)
    ownerConds.push(
      and(
        eq(schema.attachments.ownerType, 'card'),
        inArray(schema.attachments.ownerId, cardIds)
      )
    )
  if (commentIds.size)
    ownerConds.push(
      and(
        eq(schema.attachments.ownerType, 'comment'),
        inArray(schema.attachments.ownerId, [...commentIds])
      )
    )
  if (docIds.length)
    ownerConds.push(
      and(
        eq(schema.attachments.ownerType, 'doc'),
        inArray(schema.attachments.ownerId, docIds)
      )
    )
  if (intakeIds.length)
    ownerConds.push(
      and(
        eq(schema.attachments.ownerType, 'inbox'),
        inArray(schema.attachments.ownerId, intakeIds)
      )
    )

  const candidateConds = [...ownerConds]
  if (referencedIds.size)
    candidateConds.push(inArray(schema.attachments.id, [...referencedIds]))
  if (!candidateConds.length) return { candidates: [], commentIds }

  const candidates = await db
    .select({
      id: schema.attachments.id,
      ownerType: schema.attachments.ownerType,
      ownerId: schema.attachments.ownerId,
      hasData: sql<boolean>`${schema.attachments.data} is not null`
    })
    .from(schema.attachments)
    .where(
      and(
        eq(schema.attachments.projectId, scope.projectId),
        or(...candidateConds)
      )
    )

  return { candidates, commentIds }
}

// Frees attachment bytes (`data = null`) when their owner is archived AND no
// active out-of-scope entity still embeds the `att_` token — the ref-count
// guard that keeps a shared/still-used image from being nuked. Toggle ON skips
// everything. Metadata rows are kept (mirrors the diff drop and backup-OFF).
export async function gcAttachmentsOnArchive(
  db: Database,
  scope: GcScope
): Promise<void> {
  const { keepAttachmentsOnArchive } = await getSystemSettings(db)
  if (keepAttachmentsOnArchive) return

  const cardIds = scope.cardIds ?? []
  const intakeIds = scope.intakeIds ?? []
  if (!cardIds.length && !intakeIds.length) return

  const { candidates, commentIds } = await collectCandidates(db, scope)
  const live = candidates.filter(c => c.hasData)
  if (!live.length) return

  const eligible = await eligibleByArchivedOwner(
    db,
    cardIds,
    intakeIds,
    commentIds,
    live
  )
  if (!eligible.length) return

  const referencedActive = await activeReferencedIds(
    db,
    scope,
    eligible.map(a => a.id)
  )

  const toClear = eligible
    .map(a => a.id)
    .filter(id => !referencedActive.has(id))
  if (toClear.length)
    await db
      .update(schema.attachments)
      .set({ data: null })
      .where(inArray(schema.attachments.id, toClear))
}

// Candidates whose owner is archived. "Archived" = the owner's `archivedAt` is
// set OR the owner belongs to this operation's scope (the sprint case, whose
// cards keep `archivedAt` null). Resolved in one query per owner type, not per
// candidate.
async function eligibleByArchivedOwner(
  db: Database,
  cardIds: string[],
  intakeIds: string[],
  scopeCommentIds: Set<string>,
  live: Candidate[]
): Promise<Candidate[]> {
  const cardOwnerIds = uniq(
    live.filter(a => a.ownerType === 'card').map(a => a.ownerId)
  )
  const commentOwnerIds = uniq(
    live
      .filter(a => a.ownerType === 'comment')
      .map(a => a.ownerId)
  ).filter(id => !scopeCommentIds.has(id))
  const docOwnerIds = uniq(
    live.filter(a => a.ownerType === 'doc').map(a => a.ownerId)
  )
  const inboxOwnerIds = uniq(
    live.filter(a => a.ownerType === 'inbox').map(a => a.ownerId)
  ).filter(id => !intakeIds.includes(id))

  const archivedCards = cardOwnerIds.length
    ? new Set(
        (
          await db
            .select({ id: schema.cards.id })
            .from(schema.cards)
            .where(
              and(
                inArray(schema.cards.id, cardOwnerIds),
                isNotNull(schema.cards.archivedAt)
              )
            )
        ).map(r => r.id)
      )
    : new Set<string>()
  // A comment is archived when ITS card is archived (comments have no archivedAt).
  const archivedComments = commentOwnerIds.length
    ? new Set(
        (
          await db
            .select({ id: schema.comments.id })
            .from(schema.comments)
            .innerJoin(
              schema.cards,
              eq(schema.comments.cardId, schema.cards.id)
            )
            .where(
              and(
                inArray(schema.comments.id, commentOwnerIds),
                isNotNull(schema.cards.archivedAt)
              )
            )
        ).map(r => r.id)
      )
    : new Set<string>()
  const archivedDocs = docOwnerIds.length
    ? new Set(
        (
          await db
            .select({ id: schema.docs.id })
            .from(schema.docs)
            .where(
              and(
                inArray(schema.docs.id, docOwnerIds),
                isNotNull(schema.docs.archivedAt)
              )
            )
        ).map(r => r.id)
      )
    : new Set<string>()
  const archivedIntake = inboxOwnerIds.length
    ? new Set(
        (
          await db
            .select({ id: schema.intakeItems.id })
            .from(schema.intakeItems)
            .where(
              and(
                inArray(schema.intakeItems.id, inboxOwnerIds),
                isNotNull(schema.intakeItems.archivedAt)
              )
            )
        ).map(r => r.id)
      )
    : new Set<string>()

  const cardScope = new Set(cardIds)
  const intakeScope = new Set(intakeIds)
  return live.filter((a) => {
    if (!a.ownerType || !a.ownerId) return false
    switch (a.ownerType) {
      case 'card':
        return cardScope.has(a.ownerId) || archivedCards.has(a.ownerId)
      case 'comment':
        return scopeCommentIds.has(a.ownerId) || archivedComments.has(a.ownerId)
      case 'doc':
        return archivedDocs.has(a.ownerId)
      case 'inbox':
        return intakeScope.has(a.ownerId) || archivedIntake.has(a.ownerId)
      default:
        return false
    }
  })
}

// Of `candidateIds`, the subset still embedded in some ACTIVE entity OUTSIDE the
// scope. One query per body table — filtered to bodies that even mention `att_`
// — then matched exactly via the id regex (not a substring scan). Scope
// exclusion is explicit (notInArray) because the entities are inert by scope,
// not by their flag: the sprint archive leaves its cards' `archivedAt` null, and
// a destroy hasn't deleted its rows yet when this runs.
async function activeReferencedIds(
  db: Database,
  scope: GcScope,
  candidateIds: string[]
): Promise<Set<string>> {
  const candidate = new Set(candidateIds)
  const referenced = new Set<string>()
  const scan = (body: string | null) => {
    for (const id of attachmentIdsInBody(body))
      if (candidate.has(id)) referenced.add(id)
  }
  const { projectId } = scope
  const cardIds = scope.cardIds ?? []
  const docIds = scope.docIds ?? []
  const intakeIds = scope.intakeIds ?? []

  const cardConds = [
    eq(schema.cards.projectId, projectId),
    isNull(schema.cards.archivedAt),
    hasAttToken(schema.cards.descriptionMd)
  ]
  if (cardIds.length) cardConds.push(notInArray(schema.cards.id, cardIds))
  for (const r of await db
    .select({ body: schema.cards.descriptionMd })
    .from(schema.cards)
    .where(and(...cardConds)))
    scan(r.body)

  const commentConds = [
    eq(schema.cards.projectId, projectId),
    isNull(schema.cards.archivedAt),
    hasAttToken(schema.comments.bodyMd)
  ]
  if (cardIds.length) commentConds.push(notInArray(schema.cards.id, cardIds))
  for (const r of await db
    .select({ body: schema.comments.bodyMd })
    .from(schema.comments)
    .innerJoin(schema.cards, eq(schema.comments.cardId, schema.cards.id))
    .where(and(...commentConds)))
    scan(r.body)

  const docConds = [
    eq(schema.docs.projectId, projectId),
    isNull(schema.docs.archivedAt),
    hasAttToken(schema.docs.bodyMd)
  ]
  if (docIds.length) docConds.push(notInArray(schema.docs.id, docIds))
  for (const r of await db
    .select({ body: schema.docs.bodyMd })
    .from(schema.docs)
    .where(and(...docConds)))
    scan(r.body)

  const intakeConds = [
    eq(schema.intakeItems.projectId, projectId),
    ne(schema.intakeItems.status, 'archived'),
    hasAttToken(schema.intakeItems.bodyMd)
  ]
  if (intakeIds.length)
    intakeConds.push(notInArray(schema.intakeItems.id, intakeIds))
  for (const r of await db
    .select({ body: schema.intakeItems.bodyMd })
    .from(schema.intakeItems)
    .where(and(...intakeConds)))
    scan(r.body)

  return referenced
}

interface DestroyScopeIds {
  cardIds: string[]
  docIds: string[]
  intakeIds: string[]
  commentIds: Set<string>
}

// Hard-deletes attachment rows tied to a destroyed scope, EXCEPT those an active
// entity outside the scope still embeds (the ref-count guard: a shared image
// survives until its last reference is destroyed). Unlike the archive GC this
// deletes the row, not just the bytes — destroy is permanent, there's no restore
// to recover metadata for — and it ignores `keepAttachmentsOnArchive` for the
// same reason (that toggle only buys back an archived image on restore).
// Candidates are owned-by-scope OR merely referenced in a destroyed body; a
// referenced one is only eligible when its owner is in-scope or already gone
// (so we never nuke an image a living out-of-scope entity still owns). Run
// before the entities are deleted so the guard scan reads the scope bodies and
// excludes them.
export async function gcAttachmentsOnDestroy(
  db: Database,
  scope: GcScope
): Promise<void> {
  const cardIds = scope.cardIds ?? []
  const docIds = scope.docIds ?? []
  const intakeIds = scope.intakeIds ?? []
  if (!cardIds.length && !docIds.length && !intakeIds.length) return

  const { candidates, commentIds } = await collectCandidates(db, scope)
  if (!candidates.length) return

  const eligible = await eligibleByDestroyedOwner(
    db,
    { cardIds, docIds, intakeIds, commentIds },
    candidates
  )
  if (!eligible.length) return

  const referencedActive = await activeReferencedIds(
    db,
    scope,
    eligible.map(a => a.id)
  )
  const toDelete = eligible
    .map(a => a.id)
    .filter(id => !referencedActive.has(id))
  if (toDelete.length)
    await db
      .delete(schema.attachments)
      .where(inArray(schema.attachments.id, toDelete))
}

// Candidates whose owner is being destroyed — i.e. the owner is in this
// operation's scope OR no longer exists (a dangling link left by an earlier
// destroy). A candidate still owned by a LIVING out-of-scope entity is excluded:
// only its reference left, the owner keeps it. Unowned referenced candidates are
// eligible (the active-reference guard still protects any live embed). One
// existence query per owner type.
async function eligibleByDestroyedOwner(
  db: Database,
  scope: DestroyScopeIds,
  candidates: Candidate[]
): Promise<Candidate[]> {
  const cardScope = new Set(scope.cardIds)
  const docScope = new Set(scope.docIds)
  const intakeScope = new Set(scope.intakeIds)

  const outOfScope = (
    ownerType: string,
    inScope: (id: string) => boolean
  ): string[] =>
    uniq(
      candidates.filter(a => a.ownerType === ownerType).map(a => a.ownerId)
    ).filter(id => !inScope(id))

  const cardOwners = outOfScope('card', id => cardScope.has(id))
  const commentOwners = outOfScope('comment', id => scope.commentIds.has(id))
  const docOwners = outOfScope('doc', id => docScope.has(id))
  const inboxOwners = outOfScope('inbox', id => intakeScope.has(id))

  const livingIds = async (
    ids: string[],
    table: typeof schema.cards | typeof schema.comments | typeof schema.docs | typeof schema.intakeItems
  ): Promise<Set<string>> =>
    ids.length
      ? new Set(
          (
            await db
              .select({ id: table.id })
              .from(table)
              .where(inArray(table.id, ids))
          ).map(r => r.id)
        )
      : new Set<string>()

  const [livingCards, livingComments, livingDocs, livingIntake] = await Promise.all([
    livingIds(cardOwners, schema.cards),
    livingIds(commentOwners, schema.comments),
    livingIds(docOwners, schema.docs),
    livingIds(inboxOwners, schema.intakeItems)
  ])

  return candidates.filter((a) => {
    if (!a.ownerType || !a.ownerId) return true
    switch (a.ownerType) {
      case 'card':
        return cardScope.has(a.ownerId) || !livingCards.has(a.ownerId)
      case 'comment':
        return scope.commentIds.has(a.ownerId) || !livingComments.has(a.ownerId)
      case 'doc':
        return docScope.has(a.ownerId) || !livingDocs.has(a.ownerId)
      case 'inbox':
        return intakeScope.has(a.ownerId) || !livingIntake.has(a.ownerId)
      default:
        return false
    }
  })
}
