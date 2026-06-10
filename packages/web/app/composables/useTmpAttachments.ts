import type { AttachmentOwnerType } from '@claude-organizer/shared'

// Tracks images uploaded by a composer whose entity does not exist yet (new
// comment / new inbox item): they upload unowned, get bound to the entity on
// submit, or deleted if the composer is abandoned. See the attachments ADR.
export function useTmpAttachments(ownerType: AttachmentOwnerType) {
  const { bindAttachmentOwner, removeAttachment } = useAttachments()
  const ids = ref<string[]>([])

  function track(id: string) {
    ids.value.push(id)
  }

  async function bindAll(ownerId: string): Promise<void> {
    const pending = ids.value.splice(0)
    await Promise.all(
      pending.map(id =>
        bindAttachmentOwner(id, { type: ownerType, id: ownerId }).catch(() => {})
      )
    )
  }

  async function discardAll(): Promise<void> {
    const pending = ids.value.splice(0)
    await Promise.all(pending.map(id => removeAttachment(id).catch(() => {})))
  }

  return { track, bindAll, discardAll }
}
