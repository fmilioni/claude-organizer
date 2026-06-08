import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
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

import { asJson, pageEnvelope, pageInputs } from './index'

export function registerCommentTools(server: McpServer, db: Database) {
  server.registerTool(
    'list_comments',
    {
      description:
        'List comments of a card. Read-only: it never marks anything as read, so scanning history is safe and never clears the user\'s unread flags. When you actually pick the card up to work it, mark the user comments you\'ve addressed with mark_comments_read. Pages with limit/offset; response is { comments, hasMore, offset }.',
      inputSchema: {
        cardId: z.string(),
        ...pageInputs
      }
    },
    async ({ cardId, limit, offset }) => {
      const rows = await listComments(db, cardId, { limit: limit + 1, offset })
      return asJson(pageEnvelope('comments', rows, limit, offset))
    }
  )

  server.registerTool(
    'list_unread_comments',
    {
      description:
        'List all user comments not yet read by the AI for a project. Does NOT mark them as read. Pages with limit/offset; response is { comments, hasMore, offset }.',
      inputSchema: { projectId: z.string(), ...pageInputs }
    },
    async ({ projectId, limit, offset }) => {
      const rows = await listUnreadCommentsForProject(
        db,
        projectId,
        limit + 1,
        offset
      )
      return asJson(pageEnvelope('comments', rows, limit, offset))
    }
  )

  server.registerTool(
    'add_comment',
    {
      description: 'Add a comment authored by the AI to a card.',
      inputSchema: {
        cardId: z.string(),
        bodyMd: z.string().min(1)
      }
    },
    async ({ cardId, bodyMd }) =>
      asJson(await addComment(db, { cardId, bodyMd, author: 'ai' }))
  )

  server.registerTool(
    'update_comment',
    {
      description:
        'Edit the body (markdown) of an existing comment. Preserves author, timestamp and order. To remove a comment instead, use delete_comment.',
      inputSchema: { id: z.string(), bodyMd: z.string().min(1) }
    },
    async ({ id, bodyMd }) => asJson(await updateComment(db, { id, bodyMd }))
  )

  server.registerTool(
    'mark_comments_read',
    {
      description: 'Mark a list of comments as read by the AI.',
      inputSchema: { commentIds: z.array(z.string()).min(1) }
    },
    async ({ commentIds }) => {
      const updated = await markCommentsAsRead(db, commentIds)
      return asJson({ updated })
    }
  )

  server.registerTool(
    'delete_comment',
    {
      description: 'Delete a comment from a card by its id. Permanent.',
      inputSchema: { id: z.string() }
    },
    async ({ id }) => asJson(await deleteComment(db, id))
  )
}
