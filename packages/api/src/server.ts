import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'

import { createDb } from '@claude-organizer/db'

import errorHandlerPlugin from './plugins/error-handler'
import eventsPlugin from './plugins/events'
import { registerBlockerRoutes } from './routes/blockers'
import { registerCardCommitRoutes } from './routes/cardCommits'
import { registerCardRoutes } from './routes/cards'
import { registerCommentRoutes } from './routes/comments'
import { registerDocRoutes } from './routes/docs'
import { registerEventsWs } from './routes/events-ws'
import { registerProjectRoutes } from './routes/projects'
import { registerSprintRoutes } from './routes/sprints'
import { registerTagRoutes } from './routes/tags'

const port = Number(process.env.API_PORT ?? 4400)
const host = process.env.API_HOST ?? '127.0.0.1'
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const { db, close } = createDb({ url: databaseUrl })

const app = Fastify({ logger: true })

// @fastify/cors v11 narrowed the default `methods` to the CORS-safelist
// (GET,HEAD,POST), which drops PATCH/PUT/DELETE and breaks every update/delete
// from the browser (cross-origin preflight). Spell out the full set.
await app.register(cors, {
  origin: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
})
await app.register(websocket)
await app.register(errorHandlerPlugin)
await app.register(eventsPlugin)

app.get('/health', async () => ({ status: 'ok' }))

app.decorate('db', db)
registerProjectRoutes(app, db)
registerSprintRoutes(app, db)
registerCardRoutes(app, db)
registerCardCommitRoutes(app, db)
registerCommentRoutes(app, db)
registerTagRoutes(app, db)
registerBlockerRoutes(app, db)
registerDocRoutes(app, db)
registerEventsWs(app)

const shutdown = async () => {
  await app.close()
  await close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

try {
  await app.listen({ port, host })
  app.log.info(`API ready on http://${host}:${port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
