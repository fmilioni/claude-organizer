import type { MaybeRefOrGetter } from 'vue'
import { toValue } from 'vue'

import type { Card } from '~/types/card'
import type { Sprint } from '~/types/sprint'

/**
 * The board-scoped card set the Board and the Home both read: the active
 * sprint's cards plus every sprint-less card (any status, `backlog` included).
 * `cards` is the concat the columns/lists derive from; `sprintCards`/`looseCards`
 * stay exposed for callers that need a subset (Home derives sprint stats from one
 * and the backlog list from the other). The two are disjoint — sprint cards carry
 * the active sprintId, loose cards have none — so the concat never double-counts.
 */
export function useBoardCards(
  projectId: MaybeRefOrGetter<string | null | undefined>,
  activeSprint: MaybeRefOrGetter<Sprint | null | undefined>
) {
  const api = useApi()
  const sprintCards = ref<Card[]>([])
  const looseCards = ref<Card[]>([])

  async function load() {
    const pid = toValue(projectId)
    if (!pid) {
      sprintCards.value = []
      looseCards.value = []
      return
    }
    const sprint = toValue(activeSprint)
    const [sprintList, looseList] = await Promise.all([
      sprint
        ? api<Card[]>('/cards', { query: { projectId: pid, sprintId: sprint.id } })
        : Promise.resolve<Card[]>([]),
      api<Card[]>('/cards', { query: { projectId: pid, backlogOnly: 'true' } })
    ])
    sprintCards.value = sprintList
    looseCards.value = looseList
  }

  const cards = computed(() => [...sprintCards.value, ...looseCards.value])

  return { sprintCards, looseCards, cards, load }
}
