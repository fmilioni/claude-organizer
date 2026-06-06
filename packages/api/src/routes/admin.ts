import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  approveUser,
  ConflictError,
  deleteUser,
  listAllUsers,
  setAuthEnabled
} from '@claude-organizer/core'
import type { Database } from '@claude-organizer/db'
import { USER_ROLES } from '@claude-organizer/shared'

// These routes are admin-only — enforced centrally in the auth-enforcement
// preHandler (ADMIN_ONLY), so the handlers don't re-check the role.
const approveBody = z.object({
  role: z.enum(USER_ROLES),
  allProjects: z.boolean(),
  projectIds: z.array(z.string()).optional()
})
const settingsBody = z.object({ authEnabled: z.boolean() })

export function registerAdminRoutes(app: FastifyInstance, db: Database) {
  app.get('/admin/users', async () => listAllUsers(db))

  app.post<{ Params: { id: string } }>(
    '/admin/users/:id/approve',
    async (req) => {
      const body = approveBody.parse(req.body)
      return approveUser(db, req.params.id, body)
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/admin/users/:id',
    async (req, reply) => {
      // Defense-in-depth for the UI's own-row block: never let an admin delete
      // their own account (auto-lockout). authUser is null in sem-auth — no
      // session, no self concept, so deletion is unrestricted there.
      if (req.authUser?.userId === req.params.id) {
        throw new ConflictError('Cannot remove your own account')
      }
      const removed = await deleteUser(db, req.params.id)
      if (!removed) return reply.code(404).send({ error: 'not_found' })
      return { deleted: true }
    }
  )

  app.post('/admin/settings', async (req) => {
    const { authEnabled } = settingsBody.parse(req.body)
    return setAuthEnabled(db, authEnabled)
  })
}
