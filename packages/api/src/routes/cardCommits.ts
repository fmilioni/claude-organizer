import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { attachCardCommit, listCardCommits } from '@claude-organizer/core'
import type { Database } from '@claude-organizer/db'

// `committedAt` arrives as an ISO string on the wire; the core coerces it.
const attachCommitBody = z.object({
  sha: z.string().min(1),
  message: z.string().min(1),
  stat: z.string().nullish(),
  diff: z.string().nullish(),
  committedAt: z.string().nullish(),
  authorName: z.string().nullish()
})

export function registerCardCommitRoutes(app: FastifyInstance, db: Database) {
  // POST by key: the capture script parses the key from the commit message and
  // never learns the internal card id.
  app.post<{ Params: { key: string } }>(
    '/cards/:key/commits',
    async (req) => {
      const body = attachCommitBody.parse(req.body)
      return attachCardCommit(db, { cardKey: req.params.key, ...body })
    }
  )

  // GET by id: the web already holds the card id.
  app.get<{ Params: { cardId: string } }>(
    '/cards/:cardId/commits',
    async req => listCardCommits(db, req.params.cardId)
  )
}
