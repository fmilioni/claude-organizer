import type { AttachmentOwnerType } from '@claude-organizer/shared'

// Tracks images uploaded by a composer whose entity does not exist yet (new
// comment / new inbox item): they upload unowned, get bound to the entity on
// submit, or deleted if the composer is abandoned. See the attachments ADR.
export function useTmpAttachments(ownerType: AttachmentOwnerType) {
  const { bindAttachmentOwner, removeAttachment } = useAttachments()
  const toast = useToast()
  const ids = ref<string[]>([])

  function track(id: string) {
    ids.value.push(id)
  }

  // A failed bind leaves the image referenced-but-unowned (it still renders, but
  // the cleanup index lost it). The ids aren't re-tracked: the entity is already
  // submitted, so discardAll on unmount would delete an image its body still
  // cites — so surface the failure with a toast instead of swallowing it.
  async function bindAll(ownerId: string): Promise<void> {
    const pending = ids.value.splice(0)
    const results = await Promise.allSettled(
      pending.map(id => bindAttachmentOwner(id, { type: ownerType, id: ownerId }))
    )
    if (results.some(r => r.status === 'rejected')) {
      toast.add({
        title: 'Some images could not be linked',
        description: 'They may not be cleaned up automatically later.',
        color: 'error'
      })
    }
  }

  async function discardAll(): Promise<void> {
    const pending = ids.value.splice(0)
    await Promise.all(pending.map(id => removeAttachment(id).catch(() => {})))
  }

  return { track, bindAll, discardAll }
}
