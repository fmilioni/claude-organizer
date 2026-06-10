import type { AttachmentOwnerType } from '@claude-organizer/shared'

import { useProjectStore } from '~/stores/project'

export interface AttachmentOwner {
  type: AttachmentOwnerType
  id: string
}

interface UploadedAttachment {
  id: string
  url: string
  width: number
  height: number
  mime: string
}

const ATTACHMENT_ID = /att_[0-9a-z]{12}/

export function useAttachments() {
  const api = useApi()
  const store = useProjectStore()
  const base = useRuntimeConfig().public.apiUrl

  async function uploadImage(
    file: File,
    owner: AttachmentOwner | null
  ): Promise<UploadedAttachment> {
    const projectId = store.currentProject?.id
    if (!projectId) throw new Error('No project selected')
    const form = new FormData()
    form.append('file', file)
    if (owner) {
      form.append('ownerType', owner.type)
      form.append('ownerId', owner.id)
    }
    return api<UploadedAttachment>(`/attachments?projectId=${projectId}`, {
      method: 'POST',
      body: form
    })
  }

  // Stored markdown holds the portable relative path `/attachments/att_X`; the
  // browser needs an absolute, auth-aware src. Mint a serve URL (signed when auth
  // is on, bare path otherwise) and prefix the API origin since web and API are
  // different origins. A src without an attachment id (external image) passes through.
  async function resolveDisplaySrc(stored: string): Promise<string> {
    const match = ATTACHMENT_ID.exec(stored)
    if (!match) return stored
    const { url } = await api<{ url: string }>(`/attachments/${match[0]}/url`)
    return `${base}${url}`
  }

  async function bindAttachmentOwner(id: string, owner: AttachmentOwner): Promise<void> {
    await api(`/attachments/${id}`, {
      method: 'PATCH',
      body: { ownerType: owner.type, ownerId: owner.id }
    })
  }

  async function removeAttachment(id: string): Promise<void> {
    await api(`/attachments/${id}`, { method: 'DELETE' })
  }

  return { uploadImage, resolveDisplaySrc, bindAttachmentOwner, removeAttachment }
}
