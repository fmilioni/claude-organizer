import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { createId, type Database, schema } from '@claude-organizer/db'

import { reconcileAttachmentLinks } from './attachmentLinks'
import { applyChunks, backfillChunks, embedChunks } from './embedding'
import { notify } from './events'
import { paginate } from './pagination'

export const addCommentInput = z.object({
  cardId: z.string(),
  author: z.enum(['ai', 'user']),
  userId: z.string().nullable().optional(),
  bodyMd: z.string().min(1)
})
export type AddCommentInput = z.infer<typeof addCommentInput>

export const updateCommentInput = z.object({
  id: z.string(),
  bodyMd: z.string().min(1)
})
export type UpdateCommentInput = z.infer<typeof updateCommentInput>

// Allow-list, not a bare `.returning()`: the generated bodyTsv must not leak into
// the comment wire response.
const commentReturnColumns = {
  id: schema.comments.id,
  cardId: schema.comments.cardId,
  author: schema.comments.author,
  userId: schema.comments.userId,
  bodyMd: schema.comments.bodyMd,
  readByAi: schema.comments.readByAi,
  createdAt: schema.comments.createdAt
}

export async function listComments(
  db: Database,
  cardId: string,
  options: { markAsRead?: boolean, limit?: number, offset?: number } = {}
) {
  const rows = await paginate(
    db
      .select({
        id: schema.comments.id,
        cardId: schema.comments.cardId,
        author: schema.comments.author,
        userId: schema.comments.userId,
        bodyMd: schema.comments.bodyMd,
        readByAi: schema.comments.readByAi,
        createdAt: schema.comments.createdAt,
        authorName: schema.users.name,
        authorImage: schema.users.image
      })
      .from(schema.comments)
      .leftJoin(schema.users, eq(schema.users.id, schema.comments.userId))
      .where(eq(schema.comments.cardId, cardId))
      .orderBy(asc(schema.comments.createdAt))
      .$dynamic(),
    options.limit,
    options.offset
  )

  if (options.markAsRead) {
    const unreadIds = rows
      .filter(r => r.author === 'user' && !r.readByAi)
      .map(r => r.id)
    if (unreadIds.length) {
      await db
        .update(schema.comments)
        .set({ readByAi: true })
        .where(inArray(schema.comments.id, unreadIds))
      const [card] = await db
        .select({ projectId: schema.cards.projectId })
        .from(schema.cards)
        .where(eq(schema.cards.id, cardId))
        .limit(1)
      if (card) {
        await notify(db, {
          type: 'comment.read',
          projectId: card.projectId,
          cardId
        })
      }
    }
  }
  return rows
}

export async function addComment(db: Database, input: AddCommentInput) {
  const parsed = addCommentInput.parse(input)
  const vectors = await embedChunks(parsed.bodyMd)
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.comments)
      .values({
        id: createId('cmt'),
        cardId: parsed.cardId,
        author: parsed.author,
        userId: parsed.userId ?? null,
        bodyMd: parsed.bodyMd,
        readByAi: parsed.author === 'ai'
      })
      .returning(commentReturnColumns)
    if (inserted[0])
      await reconcileAttachmentLinks(tx, 'comment', inserted[0].id, parsed.bodyMd)
    return inserted
  })
  if (row) {
    await writeCommentChunks(db, row.id, vectors)
    const [card] = await db
      .select({ projectId: schema.cards.projectId })
      .from(schema.cards)
      .where(eq(schema.cards.id, row.cardId))
      .limit(1)
    if (card) {
      await notify(db, {
        type: 'comment.added',
        projectId: card.projectId,
        cardId: row.cardId,
        commentId: row.id
      })
    }
  }
  if (!row) return row
  let authorName: string | null = null
  let authorImage: string | null = null
  if (row.userId) {
    const [u] = await db
      .select({ name: schema.users.name, image: schema.users.image })
      .from(schema.users)
      .where(eq(schema.users.id, row.userId))
      .limit(1)
    authorName = u?.name ?? null
    authorImage = u?.image ?? null
  }
  return { ...row, authorName, authorImage }
}

/** Replace a comment's chunk rows with `vectors` (no-op when embeddings are off). */
function writeCommentChunks(db: Database, commentId: string, vectors: number[][] | null) {
  return applyChunks(
    db,
    vectors,
    tx => tx.delete(schema.commentChunks).where(eq(schema.commentChunks.commentId, commentId)),
    (tx, rows) =>
      tx.insert(schema.commentChunks).values(rows.map(r => ({ commentId, idx: r.idx, embedding: r.embedding })))
  )
}

export async function updateComment(db: Database, input: UpdateCommentInput) {
  const parsed = updateCommentInput.parse(input)
  // Re-chunk the body; a transient failure (null) keeps the valid vectors —
  // handled inside writeCommentChunks and the conditional set below.
  const vectors = await embedChunks(parsed.bodyMd)
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.comments)
      .set({ bodyMd: parsed.bodyMd })
      .where(eq(schema.comments.id, parsed.id))
      .returning(commentReturnColumns)
    if (updated[0])
      await reconcileAttachmentLinks(tx, 'comment', updated[0].id, parsed.bodyMd)
    return updated
  })
  if (row) {
    await writeCommentChunks(db, row.id, vectors)
    const [card] = await db
      .select({ projectId: schema.cards.projectId })
      .from(schema.cards)
      .where(eq(schema.cards.id, row.cardId))
      .limit(1)
    if (card) {
      await notify(db, {
        type: 'comment.updated',
        projectId: card.projectId,
        cardId: row.cardId,
        commentId: row.id
      })
    }
  }
  return row ?? null
}

export async function listUnreadCommentsForProject(
  db: Database,
  projectId: string,
  limit?: number,
  offset?: number
) {
  return paginate(
    db
      .select({
        id: schema.comments.id,
        cardId: schema.comments.cardId,
        bodyMd: schema.comments.bodyMd,
        createdAt: schema.comments.createdAt,
        cardTitle: schema.cards.title
      })
      .from(schema.comments)
      .innerJoin(schema.cards, eq(schema.cards.id, schema.comments.cardId))
      .where(
        and(
          eq(schema.cards.projectId, projectId),
          eq(schema.comments.author, 'user'),
          eq(schema.comments.readByAi, false)
        )
      )
      .orderBy(asc(schema.comments.createdAt))
      .$dynamic(),
    limit,
    offset
  )
}

export async function deleteComment(db: Database, id: string) {
  const [row] = await db
    .delete(schema.comments)
    .where(eq(schema.comments.id, id))
    .returning()
  if (row) {
    const [card] = await db
      .select({ projectId: schema.cards.projectId })
      .from(schema.cards)
      .where(eq(schema.cards.id, row.cardId))
      .limit(1)
    if (card) {
      await notify(db, {
        type: 'comment.deleted',
        projectId: card.projectId,
        cardId: row.cardId,
        commentId: row.id
      })
    }
  }
  return row ?? null
}

/** Backfill chunks for comments that have none yet. See `backfillChunks`. */
export function backfillCommentEmbeddings(db: Database, batchSize = 50): Promise<number> {
  return backfillChunks(
    batchSize,
    async (limit, afterId) => {
      const rows = await db
        .select({ id: schema.comments.id, bodyMd: schema.comments.bodyMd })
        .from(schema.comments)
        .where(
          and(
            sql`not exists (select 1 from comment_chunks where comment_id = ${schema.comments.id})`,
            afterId ? gt(schema.comments.id, afterId) : undefined
          )
        )
        .orderBy(asc(schema.comments.id))
        .limit(limit)
      return rows.map(r => ({ id: r.id, text: r.bodyMd }))
    },
    embedChunks,
    (id, vectors) =>
      db.insert(schema.commentChunks).values(vectors.map((embedding, idx) => ({ commentId: id, idx, embedding })))
  )
}

export async function markCommentsAsRead(db: Database, commentIds: string[]) {
  if (!commentIds.length) return 0
  const rows = await db
    .update(schema.comments)
    .set({ readByAi: true })
    .where(inArray(schema.comments.id, commentIds))
    .returning({ id: schema.comments.id, cardId: schema.comments.cardId })
  // Comments may span multiple cards; notify each affected card so open card
  // views drop the "unread by AI" badge live.
  const cardIds = [...new Set(rows.map(r => r.cardId))]
  if (cardIds.length) {
    const cards = await db
      .select({ id: schema.cards.id, projectId: schema.cards.projectId })
      .from(schema.cards)
      .where(inArray(schema.cards.id, cardIds))
    for (const card of cards) {
      await notify(db, {
        type: 'comment.read',
        projectId: card.projectId,
        cardId: card.id
      })
    }
  }
  return rows.length
}
