#!/usr/bin/env node
import {
  clearRuntimeEmbeddingConfig,
  primeEmbeddingRuntime,
  recordRuntimeEmbeddingConfig
} from '@claude-organizer/core'
import { createDb } from '@claude-organizer/db'
import { MCP_RUNTIME_SERVICE } from '@claude-organizer/shared'

import { startHttpServer } from './http'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error(
    '[claude-organizer-mcp] DATABASE_URL env var is required (see .env.example)'
  )
  process.exit(1)
}

// MCP is Streamable HTTP only (stdio was dropped in H5/CO-176). MCP_HTTP_PORT is
// an optional override; the conventional default is 4402.
const port = Number(process.env.MCP_HTTP_PORT ?? 4402)
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(
    `[claude-organizer-mcp] invalid MCP_HTTP_PORT: ${process.env.MCP_HTTP_PORT}`
  )
  process.exit(1)
}

const { db, close } = createDb({ url: databaseUrl, max: 4 })

// Push the persisted embedding choice into this process runtime (persisted > env),
// then record what we loaded so the admin status can flag this process as stale
// when the model is later changed (the MCP can't reset its singleton mid-run). The
// record failure is logged distinctly from a prime failure: it means a real model
// drift would later go unflagged, even though embeddings themselves still work.
try {
  const cfg = await primeEmbeddingRuntime(db)
  await recordRuntimeEmbeddingConfig(db, MCP_RUNTIME_SERVICE, cfg).catch((err: unknown) => {
    console.warn('[claude-organizer-mcp] embedding runtime record failed; model drift may go unflagged', err)
  })
} catch (err) {
  console.warn('[claude-organizer-mcp] embedding runtime prime failed; using env/default', err)
}

const httpServer = startHttpServer({ db, port })

const shutdown = async () => {
  httpServer.close()
  // Drop our marker so a graceful decommission doesn't leave a stale row that
  // flags a restart forever (an ungraceful kill is re-recorded on next boot).
  await clearRuntimeEmbeddingConfig(db, MCP_RUNTIME_SERVICE).catch(() => {})
  await close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
