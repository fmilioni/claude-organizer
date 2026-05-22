import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  archiveCard,
  createCard,
  destroyCard,
  getCard,
  getCardByKey,
  getCommitBySha,
  listCardCommits,
  listCards,
  moveCardToBacklog,
  moveCardToSprint,
  restoreCard,
  updateCard
} from '@claude-organizer/core'
import type { Database } from '@claude-organizer/db'

import { asJson } from './index'

// get_card/get_card_by_key embed the card's commits as METADATA only (no diff):
// the agent has the local git and can `git show <sha>`, and a squashed PR commit
// is fetched on demand via get_commit_diff. Built in the MCP layer so the shared
// Card DTO (and the web payload) stay lean.
async function withCommits(
  db: Database,
  card: Awaited<ReturnType<typeof getCard>>
) {
  if (!card) return card
  const commits = (await listCardCommits(db, card.id)).map(c => ({
    id: c.id,
    sha: c.sha,
    message: c.message,
    stat: c.stat,
    committedAt: c.committedAt,
    authorName: c.authorName,
    createdAt: c.createdAt
  }))
  return { ...card, commits }
}

const cardStatus = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'blocked'
])

export function registerCardTools(server: McpServer, db: Database) {
  server.registerTool(
    'list_cards',
    {
      description:
        'List cards of a project. Returns key/title/summary/status/etc but NOT descriptionMd (call get_card for full description). Filter by sprint, status, or backlog-only. Archived cards are hidden by default.',
      inputSchema: {
        projectId: z.string(),
        sprintId: z.string().nullable().optional(),
        status: cardStatus.optional(),
        backlogOnly: z.boolean().optional(),
        includeArchived: z
          .boolean()
          .optional()
          .describe('Include archived cards alongside active ones.'),
        archivedOnly: z
          .boolean()
          .optional()
          .describe('Return ONLY archived cards (e.g. archived column of a sprint or the backlog).')
      }
    },
    async input => asJson(await listCards(db, input))
  )

  server.registerTool(
    'get_card',
    {
      description:
        'Get a single card by its internal id (crd_xxx) with full descriptionMd.',
      inputSchema: { id: z.string() }
    },
    async ({ id }) => asJson(await withCommits(db, await getCard(db, id)))
  )

  server.registerTool(
    'get_card_by_key',
    {
      description:
        'Get a single card by its human-readable key (e.g. \'CO-12\') with full descriptionMd.',
      inputSchema: { key: z.string() }
    },
    async ({ key }) => asJson(await withCommits(db, await getCardByKey(db, key)))
  )

  server.registerTool(
    'get_commit_diff',
    {
      description:
        'Get the stored diff of a commit attached to a card, by its sha (optionally narrowed by cardId). Use it when the commit is gone from local git (e.g. squashed on merge). Returns the commit metadata plus `diff`; `diff` is null when it was cleared on archive.',
      inputSchema: {
        sha: z.string(),
        cardId: z
          .string()
          .optional()
          .describe('Narrow to one card when the same sha is attached to several.')
      }
    },
    async ({ sha, cardId }) => asJson(await getCommitBySha(db, sha, cardId))
  )

  server.registerTool(
    'create_card',
    {
      description:
        'Create a card in the backlog (default) or a specific sprint. ALWAYS provide a `summary`: one short sentence (max ~120 chars) in natural language describing WHAT this card is about. Summary shows in the board preview and in list_cards results, so users and AI can scan many cards at once. Use `descriptionMd` for full markdown details, acceptance criteria, links, etc.',
      inputSchema: {
        projectId: z.string(),
        sprintId: z.string().optional(),
        title: z.string().min(1).max(200),
        summary: z
          .string()
          .max(200)
          .optional()
          .describe('One-sentence natural language summary (~80-120 chars). Strongly encouraged.'),
        descriptionMd: z.string().optional().describe('Full markdown description. Optional.'),
        status: cardStatus.optional(),
        priority: z.number().int().min(0).max(10).optional(),
        dueDate: z.iso.datetime().optional(),
        parentId: z
          .string()
          .optional()
          .describe('Parent story card id (crd_xxx) to make this a sub-task.')
      }
    },
    async input =>
      asJson(
        await createCard(db, {
          ...input,
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined
        })
      )
  )

  server.registerTool(
    'update_card',
    {
      description: 'Update fields of a card.',
      inputSchema: {
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        summary: z.string().max(200).nullable().optional(),
        descriptionMd: z.string().optional(),
        status: cardStatus.optional(),
        priority: z.number().int().min(0).max(10).optional(),
        dueDate: z.iso.datetime().nullable().optional(),
        parentId: z
          .string()
          .nullable()
          .optional()
          .describe('Parent story card id (crd_xxx), or null to detach.')
      }
    },
    async input =>
      asJson(
        await updateCard(db, {
          ...input,
          dueDate:
            input.dueDate === null
              ? null
              : input.dueDate
                ? new Date(input.dueDate)
                : undefined
        })
      )
  )

  server.registerTool(
    'set_card_status',
    {
      description: 'Shortcut to change a card status.',
      inputSchema: { id: z.string(), status: cardStatus }
    },
    async ({ id, status }) => asJson(await updateCard(db, { id, status }))
  )

  server.registerTool(
    'move_card_to_backlog',
    {
      description: 'Remove a card from its current sprint (back to backlog).',
      inputSchema: { id: z.string() }
    },
    async ({ id }) => asJson(await moveCardToBacklog(db, id))
  )

  server.registerTool(
    'move_card_to_sprint',
    {
      description: 'Move a card to a specific sprint.',
      inputSchema: { id: z.string(), sprintId: z.string() }
    },
    async ({ id, sprintId }) => asJson(await moveCardToSprint(db, id, sprintId))
  )

  server.registerTool(
    'archive_card',
    {
      description:
        'Archive a card (soft-delete): it disappears from normal listings but is kept and can be restored. Shows up in list_cards with archivedOnly=true.',
      inputSchema: { id: z.string() }
    },
    async ({ id }) => asJson(await archiveCard(db, id))
  )

  server.registerTool(
    'restore_card',
    {
      description: 'Restore (unarchive) a previously archived card.',
      inputSchema: { id: z.string() }
    },
    async ({ id }) => asJson(await restoreCard(db, id))
  )

  server.registerTool(
    'destroy_card',
    {
      description:
        'Permanently delete a card (hard-delete, IRREVERSIBLE), along with its sub-tasks, comments, tags and blocker links. To merely hide a card, use archive_card instead.',
      inputSchema: { id: z.string() }
    },
    async ({ id }) => asJson(await destroyCard(db, id))
  )
}
