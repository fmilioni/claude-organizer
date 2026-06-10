import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { createId, type Database, schema } from '@claude-organizer/db'
import { ATTACHMENT_MIME_TYPES, ATTACHMENT_OWNER_TYPES } from '@claude-organizer/shared'

const ownerInput = z.object({
  ownerType: z.enum(ATTACHMENT_OWNER_TYPES),
  ownerId: z.string().min(1)
})

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

export async function deleteAttachment(db: Database, id: string) {
  const [row] = await db
    .delete(schema.attachments)
    .where(eq(schema.attachments.id, id))
    .returning(attachmentColumns)
  return row ?? null
}
