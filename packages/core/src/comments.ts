import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { createId, type Database, schema } from '@claude-organizer/db'

import { backfillEmbeddings, embed } from './embedding'
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

// Allow-list, not a bare `.returning()`: the generated bodyTsv and the embedding
// vector must not leak into the comment wire response.
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
  const embedding = await embed(parsed.bodyMd, 'passage')
  const [row] = await db
    .insert(schema.comments)
    .values({
      id: createId('cmt'),
      cardId: parsed.cardId,
      author: parsed.author,
      userId: parsed.userId ?? null,
      bodyMd: parsed.bodyMd,
      readByAi: parsed.author === 'ai',
      embedding
    })
    .returning(commentReturnColumns)
  if (row) {
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

export async function updateComment(db: Database, input: UpdateCommentInput) {
  const parsed = updateCommentInput.parse(input)
  // Re-embed the body; only overwrite on a successful embed so a transient
  // failure doesn't wipe a valid vector.
  const embedding = await embed(parsed.bodyMd, 'passage')
  const [row] = await db
    .update(schema.comments)
    .set(embedding ? { bodyMd: parsed.bodyMd, embedding } : { bodyMd: parsed.bodyMd })
    .where(eq(schema.comments.id, parsed.id))
    .returning(commentReturnColumns)
  if (row) {
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

/**
 * Backfill embeddings for comments missing one (post-deploy, or after a model/dim
 * change). Idempotent — only fills `embedding is null`, in batches. A no-op when
 * embeddings are disabled. Returns the count embedded.
 */
export function backfillCommentEmbeddings(db: Database, batchSize = 50): Promise<number> {
  return backfillEmbeddings(
    batchSize,
    async (limit) => {
      const rows = await db
        .select({ id: schema.comments.id, bodyMd: schema.comments.bodyMd })
        .from(schema.comments)
        .where(isNull(schema.comments.embedding))
        .limit(limit)
      return rows.map(r => ({ id: r.id, text: r.bodyMd }))
    },
    text => embed(text, 'passage'),
    (id, embedding) => db.update(schema.comments).set({ embedding }).where(eq(schema.comments.id, id))
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
