#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createDb } from '@claude-organizer/db'

import { createMcpServer } from './create-server'
import { startHttpServer } from './http'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error(
    '[claude-organizer-mcp] DATABASE_URL env var is required (see .env.example)'
  )
  process.exit(1)
}

const { db, close } = createDb({ url: databaseUrl, max: 4 })

// Transport is chosen by env: MCP_HTTP_PORT set -> Streamable HTTP (long-lived
// service, e.g. Docker/VPS); otherwise stdio (default, local Claude Code).
const httpPortEnv = process.env.MCP_HTTP_PORT

if (httpPortEnv) {
  const port = Number(httpPortEnv)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`[claude-organizer-mcp] invalid MCP_HTTP_PORT: ${httpPortEnv}`)
    process.exit(1)
  }

  const httpServer = startHttpServer({ db, port })

  const shutdown = async () => {
    httpServer.close()
    await close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
} else {
  const server = createMcpServer(db)
  const transport = new StdioServerTransport()

  const shutdown = async () => {
    await close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await server.connect(transport)
}
