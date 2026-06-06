import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  addComment,
  deleteComment,
  listComments,
  listUnreadCommentsForProject,
  markCommentsAsRead,
  updateComment
} from '@claude-organizer/core'
import type { Database } from '@claude-organizer/db'
import { COMMENT_AUTHORS } from '@claude-organizer/shared'

import { projectIdQuery, queryBool } from '../lib/query'

const listCommentsQuery = z.object({ markAsRead: queryBool })
const addCommentBody = z.object({
  bodyMd: z.string().min(1),
  author: z.enum(COMMENT_AUTHORS).optional()
})
const unreadQuery = z.object({ projectId: projectIdQuery })
const markReadBody = z.object({ commentIds: z.array(z.string()) })
const updateCommentBody = z.object({ bodyMd: z.string().min(1) })

export function registerCommentRoutes(app: FastifyInstance, db: Database) {
  app.get<{ Params: { cardId: string } }>(
    '/cards/:cardId/comments',
    async (req) => {
      const { markAsRead } = listCommentsQuery.parse(req.query)
      return listComments(db, req.params.cardId, { markAsRead })
    }
  )

  app.post<{ Params: { cardId: string } }>(
    '/cards/:cardId/comments',
    async (req) => {
      const body = addCommentBody.parse(req.body)
      const author = body.author ?? 'user'
      return addComment(db, {
        cardId: req.params.cardId,
        author,
        userId: author === 'user' ? (req.authUser?.userId ?? null) : null,
        bodyMd: body.bodyMd
      })
    }
  )

  app.get('/comments/unread', async (req) => {
    const { projectId } = unreadQuery.parse(req.query)
    return listUnreadCommentsForProject(db, projectId)
  })

  app.post('/comments/read', async (req) => {
    const { commentIds } = markReadBody.parse(req.body)
    const updated = await markCommentsAsRead(db, commentIds)
    return { updated }
  })

  app.patch<{ Params: { id: string } }>(
    '/comments/:id',
    async (req, reply) => {
      const { bodyMd } = updateCommentBody.parse(req.body)
      const updated = await updateComment(db, { id: req.params.id, bodyMd })
      if (!updated) {
        reply.code(404)
        return { error: 'Comment not found' }
      }
      return updated
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/comments/:id',
    async (req, reply) => {
      const deleted = await deleteComment(db, req.params.id)
      if (!deleted) {
        reply.code(404)
        return { error: 'Comment not found' }
      }
      return { ok: true }
    }
  )
}
