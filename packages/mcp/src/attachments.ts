import { listAttachmentsByOwners } from '@claude-organizer/core'
import type { Database } from '@claude-organizer/db'
import type { ATTACHMENT_OWNER_TYPES } from '@claude-organizer/shared'

type OwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number]
type AttachmentRow = Awaited<ReturnType<typeof listAttachmentsByOwners>>[number]

// Stable resource URI the agent reads via ReadMcpResource; shares the `<id>` with
// the HTTP serve path (CO-258), so the same image has one identity across both.
export function attachmentUri(id: string): string {
  return `attachment://${id}`
}

function toRef(a: AttachmentRow) {
  return {
    id: a.id,
    uri: attachmentUri(a.id),
    mime: a.mime,
    width: a.width,
    height: a.height,
    description: a.description
  }
}

// The `attachments` array for a single owner (a card, a doc).
export async function attachmentsForOwner(
  db: Database,
  projectId: string,
  ownerType: OwnerType,
  ownerId: string
) {
  const rows = await listAttachmentsByOwners(db, {
    projectId,
    ownerType,
    ownerIds: [ownerId]
  })
  return rows.map(toRef)
}

// One query for a whole list of same-type owners (comments, inbox items),
// grouped back by ownerId — avoids an N+1 over the list.
export async function attachmentsByOwner(
  db: Database,
  projectId: string,
  ownerType: OwnerType,
  ownerIds: string[]
): Promise<Map<string, ReturnType<typeof toRef>[]>> {
  const rows = await listAttachmentsByOwners(db, { projectId, ownerType, ownerIds })
  const byOwner = new Map<string, ReturnType<typeof toRef>[]>()
  for (const a of rows) {
    if (!a.ownerId) continue
    const list = byOwner.get(a.ownerId) ?? []
    list.push(toRef(a))
    byOwner.set(a.ownerId, list)
  }
  return byOwner
}
