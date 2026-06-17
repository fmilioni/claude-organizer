import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  archiveIntakeItem,
  createIntakeItem,
  destroyIntakeItem,
  intakeStatus,
  listIntakeItems,
  markIntakePlanned
} from '@claude-organizer/core'
import type { Database } from '@claude-organizer/db'

import { attachmentsByItem } from '../attachments'
import { asJson, pageEnvelope, pageInputs } from './index'

// Mutations echoed the whole item (with bodyMd) back; return a minimal ack — the
// agent has the demand text; use list_inbox when the full item is needed.
type IntakeAckRow = { id: string, status: string, plannedCardKeys: string | null }
function intakeAck(item: IntakeAckRow | null | undefined) {
  if (!item) return null
  return { id: item.id, status: item.status, plannedCardKeys: item.plannedCardKeys }
}

export function registerIntakeTools(server: McpServer, db: Database) {
  server.registerTool(
    'create_inbox',
    {
      description:
        'Capture a raw demand into the Inbox (a pending intake item) without planning it into cards yet. Use to save a follow-up or idea for the `plan` skill to triage later. `bodyMd` is the demand text (markdown).',
      inputSchema: {
        projectId: z.string(),
        bodyMd: z.string().min(1)
      }
    },
    async ({ projectId, bodyMd }) =>
      asJson(intakeAck(await createIntakeItem(db, { projectId, bodyMd })))
  )

  server.registerTool(
    'list_inbox',
    {
      description:
        'List the raw intake demands of a project (the Inbox). Defaults to pending demands; pass status to filter. Each item has id, bodyMd, status, plannedCardKeys and timestamps. Pages with limit/offset; response is { items, hasMore, offset }.',
      inputSchema: {
        projectId: z.string(),
        status: intakeStatus.optional(),
        ...pageInputs
      }
    },
    async ({ projectId, status, limit, offset }) => {
      const rows = await listIntakeItems(db, projectId, {
        status: status ?? 'pending',
        limit: limit + 1,
        offset
      })
      // Batch over the page only (not the limit+1 probe row), grouped per item.
      const byItem = await attachmentsByItem(
        db,
        'inbox',
        rows.slice(0, limit).map(r => r.id)
      )
      const enriched = rows.map(r => ({
        ...r,
        attachments: byItem.get(r.id) ?? []
      }))
      return asJson(pageEnvelope('items', enriched, limit, offset))
    }
  )

  server.registerTool(
    'mark_inbox_planned',
    {
      description:
        'Mark an inbox demand as planned, recording the keys of the cards it became (e.g. CO-12, CO-13). Call after a demand has been planned into cards.',
      inputSchema: {
        id: z.string(),
        cardKeys: z.array(z.string()).min(1)
      }
    },
    async ({ id, cardKeys }) =>
      asJson(intakeAck(await markIntakePlanned(db, id, cardKeys)))
  )

  server.registerTool(
    'archive_inbox',
    {
      description:
        'Archive an inbox demand (status archived) — recoverable. Use when a demand is discarded during planning but the user may want it back. Restore is done from the web.',
      inputSchema: {
        id: z.string()
      }
    },
    async ({ id }) => asJson(intakeAck(await archiveIntakeItem(db, id)))
  )

  server.registerTool(
    'destroy_inbox',
    {
      description:
        'Permanently delete an inbox demand. Use when a discarded demand should be gone for good; prefer archive_inbox when recovery might be wanted.',
      inputSchema: {
        id: z.string()
      }
    },
    async ({ id }) => asJson(intakeAck(await destroyIntakeItem(db, id)))
  )
}
