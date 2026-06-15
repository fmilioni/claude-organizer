<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

import { useProjectStore } from '~/stores/project'
import type { Card } from '~/types/card'
import type { Sprint } from '~/types/sprint'

const store = useProjectStore()
const { currentProject, currentProjectId } = storeToRefs(store)
const api = useApi()

useHead({ title: 'Tasks' })

// The Tasks screen is the home of sprint-less cards (sprintId IS NULL), split in
// three sections: Backlog (status backlog), Done (status done) and Archived.
const backlogCards = ref<Card[]>([])
const doneCards = ref<Card[]>([])
const archivedCards = ref<Card[]>([])
const allCards = ref<Card[]>([])
const sprints = ref<Sprint[]>([])

async function loadCards() {
  if (!currentProjectId.value) {
    backlogCards.value = []
    doneCards.value = []
    archivedCards.value = []
    allCards.value = []
    return
  }
  const projectId = currentProjectId.value
  ;[backlogCards.value, doneCards.value, archivedCards.value, allCards.value]
    = await Promise.all([
      api<Card[]>('/cards', {
        query: { projectId, backlogOnly: 'true', status: 'backlog' }
      }),
      api<Card[]>('/cards', {
        query: { projectId, backlogOnly: 'true', status: 'done' }
      }),
      api<Card[]>('/cards', {
        query: { projectId, backlogOnly: 'true', archivedOnly: 'true' }
      }),
      // The Backlog groups children under their story; the parent (story) card
      // usually lives elsewhere (board/sprint), so we resolve its title from the
      // full project list rather than the backlog subset alone.
      api<Card[]>('/cards', { query: { projectId } })
    ])
}

const parentTitles = computed(() => {
  const m: Record<string, string> = {}
  for (const c of allCards.value) m[c.key] = c.title
  return m
})

async function loadSprints() {
  if (!currentProjectId.value) {
    sprints.value = []
    return
  }
  sprints.value = await api<Sprint[]>('/sprints', {
    query: { projectId: currentProjectId.value }
  })
}

async function reload() {
  await Promise.all([loadCards(), loadSprints()])
}

useProjectData(currentProjectId, reload, {
  onEvent: (event) => {
    if (event.type === 'card.changed' || event.type === 'card.deleted') {
      loadCards()
    } else if (
      event.type === 'sprint.changed'
      || event.type === 'sprint.deleted'
    ) {
      loadSprints()
    }
  }
})

const moveTargets = computed(() =>
  sprints.value
    .filter(s => s.status === 'active' || s.status === 'planned')
    .sort(a => (a.status === 'active' ? -1 : 1))
)

const sortedDone = computed(() =>
  [...doneCards.value].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
)

const selectedTagIds = ref<string[]>([])

function filterByTags(list: Card[]): Card[] {
  if (!selectedTagIds.value.length) return list
  const sel = new Set(selectedTagIds.value)
  return list.filter(c => c.tags?.some(t => sel.has(t.id)))
}

const filteredBacklog = computed(() => filterByTags(backlogCards.value))
const filteredDone = computed(() => filterByTags(sortedDone.value))
const filteredArchived = computed(() => filterByTags(archivedCards.value))

async function promoteToBoard(cardId: string) {
  await api(`/cards/${cardId}`, {
    method: 'PATCH',
    body: { status: 'todo' }
  })
  await loadCards()
}

async function moveToSprint(cardId: string, sprintId: string) {
  await api(`/cards/${cardId}`, {
    method: 'PATCH',
    body: { sprintId, status: 'todo' }
  })
  await loadCards()
}

async function restoreCard(cardId: string) {
  await api(`/cards/${cardId}/restore`, { method: 'POST' })
  await loadCards()
}

async function archiveCard(cardId: string) {
  await api(`/cards/${cardId}/archive`, { method: 'POST' })
  await loadCards()
}

// Persist the Backlog order so the pull-to-sprint queue sticks across reloads.
// Cards stay in `backlog` here, so there is never a status change to apply.
async function onBacklogReorder({ orderedIds }: { orderedIds: string[] }) {
  orderedIds.forEach((id, i) => {
    const c = backlogCards.value.find(x => x.id === id)
    if (c) c.position = i
  })
  try {
    await api('/cards/reorder', { method: 'POST', body: { orderedIds } })
  } catch (err) {
    console.error('Failed to reorder backlog, reloading', err)
    await loadCards()
  }
}

function dropdownItems(cardId: string): DropdownMenuItem[][] {
  const sections: DropdownMenuItem[][] = [
    [
      {
        label: 'Send to board (To do)',
        icon: 'i-lucide-arrow-up-circle',
        onSelect: () => promoteToBoard(cardId)
      }
    ]
  ]
  if (moveTargets.value.length > 0) {
    sections.push(
      moveTargets.value.map(s => ({
        label: `Move to ${s.name}`,
        icon: s.status === 'active' ? 'i-lucide-flame' : 'i-lucide-calendar',
        onSelect: () => moveToSprint(cardId, s.id)
      }))
    )
  }
  return sections
}

const isEmpty = computed(
  () =>
    !backlogCards.value.length
    && !doneCards.value.length
    && !archivedCards.value.length
)

const noFilterMatches = computed(
  () =>
    selectedTagIds.value.length > 0
    && !filteredBacklog.value.length
    && !filteredDone.value.length
    && !filteredArchived.value.length
)
</script>

<template>
  <UDashboardPanel id="tasks">
    <template #header>
      <UDashboardNavbar title="Tasks">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UIcon name="i-lucide-list-todo" class="text-primary" />
        </template>
        <template #right>
          <BoardTagFilter
            v-model="selectedTagIds"
            :project-id="currentProjectId"
          />
          <UBadge variant="subtle">
            {{ filteredBacklog.length }} backlog
          </UBadge>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="!currentProject" class="text-center text-muted py-12">
        Pick a project in the sidebar.
      </div>

      <div v-else class="space-y-8 w-full">
        <div v-if="isEmpty" class="text-center text-muted py-12">
          No sprint-less tasks yet.
        </div>
        <div v-else-if="noFilterMatches" class="text-center text-muted py-12">
          No tasks match the selected tags.
        </div>

        <section v-if="filteredBacklog.length" class="space-y-2">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-2">
            <UIcon name="i-lucide-inbox" class="size-4" />
            Backlog
            <span class="text-muted/70 font-normal normal-case">{{ filteredBacklog.length }}</span>
          </h2>
          <CardDraggableList
            :status="'backlog'"
            :cards="filteredBacklog"
            group-by-story
            :parent-titles="parentTitles"
            list-class="flex flex-col"
            @reorder="onBacklogReorder"
          >
            <template #actions="{ card }">
              <UButton
                icon="i-lucide-archive"
                size="xs"
                color="neutral"
                variant="soft"
                label="Archive"
                @click="archiveCard(card.id)"
              />
              <ArchiveDestroyMenu
                kind="card"
                size="xs"
                :can-archive="false"
                :extra-sections="dropdownItems(card.id)"
                :entity-id="card.id"
                :entity-label="`${card.key} ${card.title}`"
                @destroyed="loadCards"
              />
            </template>
          </CardDraggableList>
        </section>

        <ArchivedDisclosure
          :count="filteredDone.length"
          label="Done"
          icon="i-lucide-check-check"
        >
          <div class="space-y-2">
            <CardTile
              v-for="card in filteredDone"
              :key="card.id"
              :card="card"
              show-parent-key
            >
              <template #actions>
                <UButton
                  icon="i-lucide-archive"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  label="Archive"
                  @click="archiveCard(card.id)"
                />
                <ArchiveDestroyMenu
                  kind="card"
                  size="xs"
                  :can-archive="false"
                  :extra-sections="dropdownItems(card.id)"
                  :entity-id="card.id"
                  :entity-label="`${card.key} ${card.title}`"
                  @destroyed="loadCards"
                />
              </template>
            </CardTile>
          </div>
        </ArchivedDisclosure>

        <ArchivedDisclosure :count="filteredArchived.length" label="Archived">
          <div class="space-y-2">
            <CardTile
              v-for="card in filteredArchived"
              :key="card.id"
              :card="card"
              show-parent-key
              class="opacity-70 border-dashed!"
            >
              <template #actions>
                <UButton
                  icon="i-lucide-archive-restore"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  label="Restore"
                  @click="restoreCard(card.id)"
                />
                <ArchiveDestroyMenu
                  kind="card"
                  size="xs"
                  :can-archive="false"
                  :entity-id="card.id"
                  :entity-label="`${card.key} ${card.title}`"
                  @destroyed="loadCards"
                />
              </template>
            </CardTile>
          </div>
        </ArchivedDisclosure>
      </div>
    </template>
  </UDashboardPanel>
</template>
