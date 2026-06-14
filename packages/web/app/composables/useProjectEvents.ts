import { type MaybeRefOrGetter, toValue } from 'vue'

import type { CoSocketMessage } from '@claude-organizer/shared'

export type { CoEvent, CoSocketMessage } from '@claude-organizer/shared'

export function useProjectEvents(
  projectId: MaybeRefOrGetter<string | null | undefined>,
  handler: (event: CoSocketMessage) => void
) {
  if (import.meta.server) return

  const config = useRuntimeConfig()
  const apiUrl = config.public.apiUrl as string

  const url = () => {
    const id = toValue(projectId)
    if (!id) return undefined
    return apiUrl.replace(/^http/, 'ws') + `/ws/projects/${id}`
  }

  useWebSocket(url, {
    autoReconnect: { delay: 2000 },
    onMessage: (_ws, e) => {
      let message: CoSocketMessage | undefined
      try {
        message = JSON.parse(e.data) as CoSocketMessage
      } catch {
        return
      }
      handler(message)
    }
  })
}
