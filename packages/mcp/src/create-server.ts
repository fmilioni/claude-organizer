import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { Database } from '@claude-organizer/db'

import packageJson from '../package.json'
import { registerResources } from './resources/index'
import { assertToolAccess, type McpScope } from './scope'
import { registerTools } from './tools/index'

type ToolHandler = (input: Record<string, unknown>, extra: unknown) => unknown

// Builds a fully-registered MCP server. The HTTP transport creates one per
// session, passing the session's resolved `scope`; `db` is shared.
//
// `scope` (null = unrestricted: sem-auth mode) is enforced at a single choke
// point: registerTool is wrapped so EVERY tool runs `assertToolAccess` before its
// handler — a new tool can't forget to scope, and an unmapped one fails closed.
export function createMcpServer(db: Database, scope: McpScope | null = null) {
  const server = new McpServer({
    name: 'claude-organizer',
    version: packageJson.version
  })

  const registerTool = server.registerTool.bind(server)
  server.registerTool = function (
    ...args: Parameters<typeof server.registerTool>
  ) {
    const [name, config, handler] = args as [string, unknown, ToolHandler]
    return registerTool(
      name,
      config as Parameters<typeof registerTool>[1],
      (async (input: Record<string, unknown>, extra: unknown) => {
        await assertToolAccess(db, scope, name, input ?? {})
        return handler(input, extra)
      }) as Parameters<typeof registerTool>[2]
    )
  } as typeof server.registerTool

  registerTools(server, db, scope)
  registerResources(server, db, scope)

  return server
}
