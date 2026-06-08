import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  archiveCard,
  createCard,
  destroyCard,
  getCard,
  getCardByKey,
  getCardsByIds,
  getCommitBySha,
  listCardCommits,
  listCards,
  moveCardToBacklog,
  moveCardToSprint,
  reorderCards,
  restoreCard,
  searchCards,
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
        'List cards of a project, focused. Returns key/title/summary/status/etc but NOT descriptionMd (call get_card for full description). Filter by sprint, status (single OR a list), activeOnly (everything but done/backlog), tag, or backlog-only, and page with limit/offset. Defaults to limit 100 so a broad listing never blows the context. Response is { cards, hasMore, offset } — raise offset (or narrow the filter) to see the rest. Archived cards are hidden by default.',
      inputSchema: {
        projectId: z.string(),
        sprintId: z.string().nullable().optional(),
        status: z
          .union([cardStatus, z.array(cardStatus)])
          .optional()
          .describe('Restrict to one status or a list of statuses.'),
        activeOnly: z
          .boolean()
          .optional()
          .describe('Shortcut for everything but done/backlog.'),
        tag: z.string().optional().describe('Tag id or name.'),
        backlogOnly: z.boolean().optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .default(100)
          .describe('Max cards to return (default 100, max 200).'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Skip N cards — page through results with limit + offset.'),
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
    async ({ limit, offset, ...filters }) => {
      // Probe one past the page so `hasMore` is exact without a COUNT query.
      const rows = await listCards(db, { ...filters, limit: limit + 1, offset })
      const hasMore = rows.length > limit
      return asJson({
        cards: hasMore ? rows.slice(0, limit) : rows,
        hasMore,
        offset: offset ?? 0
      })
    }
  )

  server.registerTool(
    'search_cards',
    {
      description:
        'Ranked full-text search over cards AND their comments. Searches key/title/summary/description AND comment bodies — a card matches if the term hits the card OR any of its comments. Ranked by relevance; accepts web-style queries (quoted phrases, OR, -exclude) and tolerates substring/typo (trigram). Returns card summaries WITHOUT descriptionMd PLUS the matched comment snippet when the hit came from a comment — use get_card for the full detail. Accepts the focused-read filters (status/activeOnly, sprintId, tag) to search within a slice. Read-only: never marks comments as read.',
      inputSchema: {
        projectId: z.string(),
        query: z.string().min(1),
        status: z
          .union([cardStatus, z.array(cardStatus)])
          .optional()
          .describe('Restrict to one status or a list of statuses.'),
        activeOnly: z
          .boolean()
          .optional()
          .describe('Shortcut for everything but done/backlog.'),
        sprintId: z.string().optional(),
        tag: z.string().optional().describe('Tag id or name.'),
        includeArchived: z.boolean().optional(),
        archivedOnly: z.boolean().optional()
      }
    },
    async ({ projectId, query, ...filters }) =>
      asJson(await searchCards(db, projectId, query, filters))
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
    'get_cards',
    {
      description:
        'Batch-read full cards (WITH descriptionMd) by id (crd_xxx) and/or key (CO-12) in one call — the post-search companion to get_card when you need the detail of several hits at once. Mix ids and keys freely. Capped at 50 per call to keep the response bounded.',
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .max(50)
          .describe('Card ids (crd_xxx) and/or keys (CO-12), mixed — max 50 per call.')
      }
    },
    async ({ ids }) => asJson(await getCardsByIds(db, ids))
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
    'reorder_cards',
    {
      description:
        'Persist the board order of cards in batch: writes position = index (0,1,2,…) for each id in `orderedIds`, in the given order. The board sorts by position ASC, so pass the cards in the order they should appear top-to-bottom. Mirrors the board drag-reorder; use it to order a set of cards programmatically (e.g. by execution order after planning).',
      inputSchema: {
        orderedIds: z
          .array(z.string())
          .min(1)
          .describe(
            'Card ids (crd_xxx) in the desired order; each card gets position = its index in this list.'
          )
      }
    },
    async ({ orderedIds }) => asJson(await reorderCards(db, { orderedIds }))
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
