import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  archiveProject,
  createProject,
  destroyProject,
  getProjectBySlug,
  listProjects,
  restoreProject,
  setProjectRepo,
  updateProjectKeyPrefix
} from '@claude-organizer/core'
import type { Database } from '@claude-organizer/db'

import { asJson } from './index'

export function registerProjectTools(server: McpServer, db: Database) {
  server.registerTool(
    'list_projects',
    {
      description:
        'List all projects tracked by claude-organizer. Archived projects are hidden by default.',
      inputSchema: {
        includeArchived: z
          .boolean()
          .optional()
          .describe('Include archived projects alongside active ones.'),
        archivedOnly: z
          .boolean()
          .optional()
          .describe('Return ONLY archived projects.')
      }
    },
    async ({ includeArchived, archivedOnly }) =>
      asJson(await listProjects(db, { includeArchived, archivedOnly }))
  )

  server.registerTool(
    'get_project',
    {
      description: 'Get a project by its slug.',
      inputSchema: { slug: z.string().describe('Project slug (e.g. \'my-app\')') }
    },
    async ({ slug }) => asJson(await getProjectBySlug(db, slug))
  )

  server.registerTool(
    'create_project',
    {
      description:
        'Create a new project workspace. keyPrefix becomes the prefix for card keys (e.g. \'CO\' produces CO-1, CO-2). If omitted, derived from the slug.',
      inputSchema: {
        name: z.string().min(1).max(120),
        slug: z
          .string()
          .min(1)
          .max(60)
          .regex(/^[a-z0-9][a-z0-9-]*$/),
        description: z.string().max(2000).optional(),
        keyPrefix: z
          .string()
          .min(1)
          .max(10)
          .regex(/^[A-Z][A-Z0-9]{0,9}$/)
          .optional()
          .describe('Uppercase letters/digits, starting with a letter. Max 10 chars.')
      }
    },
    async input => asJson(await createProject(db, input))
  )

  server.registerTool(
    'update_project_key_prefix',
    {
      description:
        'Change the keyPrefix of a project. Existing card keys are NOT renamed - only new cards use the new prefix.',
      inputSchema: {
        projectId: z.string(),
        newPrefix: z
          .string()
          .min(1)
          .max(10)
          .regex(/^[A-Z][A-Z0-9]{0,9}$/)
      }
    },
    async ({ projectId, newPrefix }) =>
      asJson(await updateProjectKeyPrefix(db, projectId, newPrefix))
  )

  server.registerTool(
    'archive_project',
    {
      description:
        'Archive a project (soft, reversible). It disappears from list_projects by default and can be restored.',
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => asJson(await archiveProject(db, projectId))
  )

  server.registerTool(
    'restore_project',
    {
      description: 'Restore a previously archived project.',
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => asJson(await restoreProject(db, projectId))
  )

  server.registerTool(
    'destroy_project',
    {
      description:
        'DESTRUCTIVE & IRREVERSIBLE: permanently delete a project and EVERYTHING under it (sprints, cards, docs, tags, comments). Requires `confirmSlug` to equal the project slug; otherwise nothing is deleted.',
      inputSchema: {
        projectId: z.string(),
        confirmSlug: z
          .string()
          .describe('Must equal the project slug to confirm the deletion.')
      }
    },
    async ({ projectId, confirmSlug }) =>
      asJson(await destroyProject(db, projectId, confirmSlug))
  )

  server.registerTool(
    'set_project_repo',
    {
      description:
        'Set (or clear) the project\'s source repository so commit hashes link to the provider\'s commit page. Pass `provider` (github|gitlab) + `repoWebUrl` (e.g. https://github.com/owner/repo), or null on both to clear. The skill calls this after detecting the git remote.',
      inputSchema: {
        projectId: z.string(),
        provider: z.enum(['github', 'gitlab']).nullable(),
        repoWebUrl: z
          .url()
          .nullable()
          .describe('Repo web base, e.g. https://github.com/owner/repo (no .git).')
      }
    },
    async ({ projectId, provider, repoWebUrl }) =>
      asJson(await setProjectRepo(db, { projectId, provider, repoWebUrl }))
  )
}
