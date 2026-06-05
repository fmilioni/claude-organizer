import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { resolveCommitTokenSecret, signCommitToken } from '@claude-organizer/core'

import { asJson } from './index'

export function registerCommitTools(server: McpServer) {
  server.registerTool(
    'issue_commit_token',
    {
      description:
        'Mint a short-lived, card-scoped token that authenticates the diff-capture scripts (attach-commit / attach-worktree-diff) against the API when auth is on. The token only authorizes attaching/clearing the diff of THIS card and expires quickly; it cannot be reused for another card. The caller (the skill) exports it as CO_COMMIT_TOKEN so the script sends it in the X-CO-Commit-Token header. In sem-auth mode the scripts work without a token — minting is only needed when auth is enabled.',
      inputSchema: { cardKey: z.string() }
    },
    async ({ cardKey }) => {
      const secret = resolveCommitTokenSecret()
      if (!secret) {
        throw new Error(
          'Commit-token signing is not configured: set CO_COMMIT_TOKEN_SECRET or BETTER_AUTH_SECRET.'
        )
      }
      return asJson({ cardKey, ...signCommitToken(cardKey, secret) })
    }
  )
}
