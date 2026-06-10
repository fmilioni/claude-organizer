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

// Entities entering the archived scope by one archive operation. The sprint case
// passes its cards even though their `archivedAt` stays null (the aggressive
// "free the bytes of this dormant sprint" drop), so scope membership — not
// `archivedAt` — is what marks an owner archived and a reference inert here.
interface ArchiveScope {
  projectId: string
  cardIds?: string[]
  intakeIds?: string[]
}

interface Candidate {
  id: string
  ownerType: string | null
  ownerId: string | null
}

const uniq = (ids: Array<string | null>): string[] =>
  [...new Set(ids.filter((id): id is string => id != null))]

const hasAttToken = (col: PgColumn) =>
  sql`strpos(coalesce(${col}, ''), 'att_') > 0`

// Frees attachment bytes (`data = null`) when their owner is archived AND no
// active out-of-scope entity still embeds the `att_` token — the ref-count
// guard that keeps a shared/still-used image from being nuked. Toggle ON skips
// everything. Metadata rows are kept (mirrors the diff drop and backup-OFF).
export async function gcAttachmentsOnArchive(
  db: Database,
  scope: ArchiveScope
): Promise<void> {
  const { keepAttachmentsOnArchive } = await getSystemSettings(db)
  if (keepAttachmentsOnArchive) return

  const cardIds = scope.cardIds ?? []
  const intakeIds = scope.intakeIds ?? []
  if (!cardIds.length && !intakeIds.length) return

  // A comment can't be archived on its own — it travels with its card, so the
  // scope's cards drag in their comments (owners and reference sources alike).
  const scopeComments = cardIds.length
    ? await db
        .select({ id: schema.comments.id, bodyMd: schema.comments.bodyMd })
        .from(schema.comments)
        .where(inArray(schema.comments.cardId, cardIds))
    : []
  const scopeCommentIds = new Set(scopeComments.map(c => c.id))

  const scopeCards = cardIds.length
    ? await db
        .select({ descriptionMd: schema.cards.descriptionMd })
        .from(schema.cards)
        .where(inArray(schema.cards.id, cardIds))
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
  if (scopeCommentIds.size)
    ownerConds.push(
      and(
        eq(schema.attachments.ownerType, 'comment'),
        inArray(schema.attachments.ownerId, [...scopeCommentIds])
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
  if (!candidateConds.length) return

  // hasData skips already-cleared bytes without pulling the bytea off the wire.
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

  const live = candidates.filter(c => c.hasData)
  if (!live.length) return

  const eligible = await eligibleByArchivedOwner(
    db,
    cardIds,
    intakeIds,
    scopeCommentIds,
    live
  )
  if (!eligible.length) return

  const referencedActive = await activeReferencedIds(
    db,
    scope,
    cardIds,
    intakeIds,
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

// Of `eligibleIds`, the subset still embedded in some ACTIVE entity OUTSIDE the
// archived scope. One query per body table — filtered to bodies that even
// mention `att_` — then matched exactly via the id regex (not a substring
// scan). Scope exclusion is explicit (notInArray) because the sprint case
// leaves its cards' `archivedAt` null: they're inert by scope, not by the flag.
async function activeReferencedIds(
  db: Database,
  scope: ArchiveScope,
  cardIds: string[],
  intakeIds: string[],
  eligibleIds: string[]
): Promise<Set<string>> {
  const eligible = new Set(eligibleIds)
  const referenced = new Set<string>()
  const scan = (body: string | null) => {
    for (const id of attachmentIdsInBody(body))
      if (eligible.has(id)) referenced.add(id)
  }
  const { projectId } = scope

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

  for (const r of await db
    .select({ body: schema.docs.bodyMd })
    .from(schema.docs)
    .where(
      and(
        eq(schema.docs.projectId, projectId),
        isNull(schema.docs.archivedAt),
        hasAttToken(schema.docs.bodyMd)
      )
    ))
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
