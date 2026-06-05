import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { Database } from '@claude-organizer/db'

import type { McpScope } from '../scope'
import { registerBlockerTools } from './blockers'
import { registerCardTools } from './cards'
import { registerCommentTools } from './comments'
import { registerCommitTools } from './commits'
import { registerDocTools } from './docs'
import { registerIntakeTools } from './intake'
import { registerProjectTools } from './projects'
import { registerSprintTools } from './sprints'
import { registerTagTools } from './tags'

// Per-tool authorization is enforced centrally in createMcpServer (registerTool
// wrapper). `scope` only reaches registerProjectTools, which needs it to filter
// list_projects' OUTPUT (the others just deny, handled by the wrapper).
export function registerTools(
  server: McpServer,
  db: Database,
  scope: McpScope | null
) {
  registerProjectTools(server, db, scope)
  registerSprintTools(server, db)
  registerCardTools(server, db)
  registerCommentTools(server, db)
  registerCommitTools(server)
  registerTagTools(server, db)
  registerBlockerTools(server, db)
  registerDocTools(server, db)
  registerIntakeTools(server, db)
}

export function asJson(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  }
}
