import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { createId, type Database, schema } from '@claude-organizer/db'
import { ATTACHMENT_MIME_TYPES, ATTACHMENT_OWNER_TYPES } from '@claude-organizer/shared'

import { ConflictError, InputError } from './errors'

const ownerInput = z.object({
  ownerType: z.enum(ATTACHMENT_OWNER_TYPES),
  ownerId: z.string().min(1)
})

type Owner = z.infer<typeof ownerInput>

// The owner-link is polymorphic with no FK (markdown is the source of truth), so
// scope is enforced here: the owner must be a live entity of `ownerType` in the
// attachment's own project. A comment carries no projectId — it's scoped through
// its card. Guards both the upload owner and the tmp→owner bind.
async function ownerExistsInProject(
  db: Database,
  projectId: string,
  owner: Owner
): Promise<boolean> {
  switch (owner.ownerType) {
    case 'card': {
      const [r] = await db
        .select({ id: schema.cards.id })
        .from(schema.cards)
        .where(
          and(
            eq(schema.cards.id, owner.ownerId),
            eq(schema.cards.projectId, projectId)
          )
        )
        .limit(1)
      return r != null
    }
    case 'comment': {
      const [r] = await db
        .select({ id: schema.comments.id })
        .from(schema.comments)
        .innerJoin(schema.cards, eq(schema.comments.cardId, schema.cards.id))
        .where(
          and(
            eq(schema.comments.id, owner.ownerId),
            eq(schema.cards.projectId, projectId)
          )
        )
        .limit(1)
      return r != null
    }
    case 'doc': {
      const [r] = await db
        .select({ id: schema.docs.id })
        .from(schema.docs)
        .where(
          and(
            eq(schema.docs.id, owner.ownerId),
            eq(schema.docs.projectId, projectId)
          )
        )
        .limit(1)
      return r != null
    }
    case 'inbox': {
      const [r] = await db
        .select({ id: schema.intakeItems.id })
        .from(schema.intakeItems)
        .where(
          and(
            eq(schema.intakeItems.id, owner.ownerId),
            eq(schema.intakeItems.projectId, projectId)
          )
        )
        .limit(1)
      return r != null
    }
  }
}

async function assertOwnerInProject(db: Database, projectId: string, owner: Owner) {
  if (!(await ownerExistsInProject(db, projectId, owner))) {
    throw new InputError(
      `Owner ${owner.ownerType} "${owner.ownerId}" does not exist in this project`
    )
  }
}

export const createAttachmentInput = z.object({
  projectId: z.string(),
  mime: z.enum(ATTACHMENT_MIME_TYPES),
  data: z.instanceof(Uint8Array),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  filename: z.string().nullish(),
  description: z.string().nullish(),
  owner: ownerInput.nullish()
})
export type CreateAttachmentInput = z.infer<typeof createAttachmentInput>

// Metadata projection — never selects `data`, so list/create payloads stay
// lean; only getAttachment pulls the bytes (the serve path needs them).
const attachmentColumns = {
  id: schema.attachments.id,
  projectId: schema.attachments.projectId,
  ownerType: schema.attachments.ownerType,
  ownerId: schema.attachments.ownerId,
  mime: schema.attachments.mime,
  filename: schema.attachments.filename,
  byteSize: schema.attachments.byteSize,
  width: schema.attachments.width,
  height: schema.attachments.height,
  description: schema.attachments.description,
  createdAt: schema.attachments.createdAt
}

export async function createAttachment(db: Database, input: CreateAttachmentInput) {
  const parsed = createAttachmentInput.parse(input)
  if (parsed.owner) await assertOwnerInProject(db, parsed.projectId, parsed.owner)
  const data = Buffer.isBuffer(parsed.data) ? parsed.data : Buffer.from(parsed.data)
  const [row] = await db
    .insert(schema.attachments)
    .values({
      id: createId('att'),
      projectId: parsed.projectId,
      ownerType: parsed.owner?.ownerType ?? null,
      ownerId: parsed.owner?.ownerId ?? null,
      mime: parsed.mime,
      filename: parsed.filename ?? null,
      byteSize: data.length,
      width: parsed.width,
      height: parsed.height,
      description: parsed.description ?? null,
      data
    })
    .returning(attachmentColumns)
  return row!
}

// Binds an unowned (tmp) attachment to its entity after the entity exists — the
// new-comment / new-inbox composers upload before they have an id, then set the
// owner on submit (the owner-link is the cleanup index; see the attachments ADR).
export async function setAttachmentOwner(
  db: Database,
  id: string,
  owner: { ownerType: (typeof ATTACHMENT_OWNER_TYPES)[number], ownerId: string }
) {
  const parsed = ownerInput.parse(owner)
  const [current] = await db
    .select({
      projectId: schema.attachments.projectId,
      ownerType: schema.attachments.ownerType
    })
    .from(schema.attachments)
    .where(eq(schema.attachments.id, id))
    .limit(1)
  if (!current) return null
  // Bind is the one-shot tmp→owner step; an already-owned attachment is never
  // re-pointed (it would orphan the previous owner's cleanup index).
  if (current.ownerType) {
    throw new ConflictError('Attachment already has an owner')
  }
  await assertOwnerInProject(db, current.projectId, parsed)
  // `isNull(ownerType)` folds the re-bind guard into the write so two concurrent
  // binds can't both pass the read above; the loser updates zero rows → 409.
  const [row] = await db
    .update(schema.attachments)
    .set({ ownerType: parsed.ownerType, ownerId: parsed.ownerId })
    .where(and(eq(schema.attachments.id, id), isNull(schema.attachments.ownerType)))
    .returning(attachmentColumns)
  if (!row) throw new ConflictError('Attachment already has an owner')
  return row
}

export async function getAttachment(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(schema.attachments)
    .where(eq(schema.attachments.id, id))
    .limit(1)
  return row ?? null
}

// Metadata only — no bytes. The serve path needs `getAttachment` (with `data`);
// an existence check (e.g. before minting a serve URL) takes this lean read.
export async function getAttachmentMeta(db: Database, id: string) {
  const [row] = await db
    .select(attachmentColumns)
    .from(schema.attachments)
    .where(eq(schema.attachments.id, id))
    .limit(1)
  return row ?? null
}

export async function listAttachments(
  db: Database,
  options: {
    projectId: string
    owner?: { ownerType: (typeof ATTACHMENT_OWNER_TYPES)[number], ownerId: string }
  }
) {
  const conditions = [eq(schema.attachments.projectId, options.projectId)]
  if (options.owner) {
    conditions.push(
      eq(schema.attachments.ownerType, options.owner.ownerType),
      eq(schema.attachments.ownerId, options.owner.ownerId)
    )
  }
  return db
    .select(attachmentColumns)
    .from(schema.attachments)
    .where(and(...conditions))
    .orderBy(desc(schema.attachments.createdAt))
}

// Batch read for a set of same-type owners — one query for a whole comment/inbox
// list instead of N. Rows keep `ownerId` so the caller can group them back.
export async function listAttachmentsByOwners(
  db: Database,
  options: {
    projectId: string
    ownerType: (typeof ATTACHMENT_OWNER_TYPES)[number]
    ownerIds: string[]
  }
) {
  if (options.ownerIds.length === 0) return []
  return db
    .select(attachmentColumns)
    .from(schema.attachments)
    .where(
      and(
        eq(schema.attachments.projectId, options.projectId),
        eq(schema.attachments.ownerType, options.ownerType),
        inArray(schema.attachments.ownerId, options.ownerIds)
      )
    )
    .orderBy(desc(schema.attachments.createdAt))
}

// Attachment ids embedded in entity bodies as `![alt](…att_X…)`. The id token
// is the rewrite key, not the URL wrapper — so it's format-independent.
const attachmentIdToken = /att_[0-9a-z]{12}/g

// Single-pass swap of `att_` tokens via the id-map: an unmapped token is left
// intact, and a freshly-mapped id can't be re-matched by a later replacement.
export function rewriteAttachmentIds(
  body: string | null | undefined,
  idMap: Record<string, string>
): string | null {
  if (!body) return body ?? null
  return body.replace(attachmentIdToken, token => idMap[token] ?? token)
}

export function attachmentIdsInBody(body: string | null | undefined): string[] {
  if (!body) return []
  return [...new Set(body.match(attachmentIdToken) ?? [])]
}

export async function deleteAttachment(db: Database, id: string) {
  const [row] = await db
    .delete(schema.attachments)
    .where(eq(schema.attachments.id, id))
    .returning(attachmentColumns)
  return row ?? null
}
