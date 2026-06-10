<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'

import { useProjectStore } from '~/stores/project'
import type { CardSearchResult } from '~/types/card'

const store = useProjectStore()
const api = useApi()

const open = ref(false)
const searchTerm = ref('')
const results = ref<CardSearchResult[]>([])
const loading = ref(false)

const term = computed(() => searchTerm.value.trim())

// A monotonic ticket discards out-of-order responses (same guard as the /search page).
let ticket = 0
let timer: ReturnType<typeof setTimeout> | undefined

watch(searchTerm, () => {
  if (timer) clearTimeout(timer)
  const value = term.value
  if (!value) {
    ticket++
    results.value = []
    loading.value = false
    return
  }
  loading.value = true
  timer = setTimeout(() => void runSearch(value), 250)
})

async function runSearch(value: string) {
  const projectId = store.currentProjectId
  if (!projectId) {
    loading.value = false
    return
  }
  const mine = ++ticket
  try {
    const data = await api<CardSearchResult[]>('/cards', { query: { projectId, q: value } })
    if (mine !== ticket) return
    results.value = data
  } catch {
    if (mine === ticket) results.value = []
  } finally {
    if (mine === ticket) loading.value = false
  }
}

watch(open, (isOpen) => {
  if (!isOpen) {
    ticket++
    searchTerm.value = ''
    results.value = []
    loading.value = false
  }
})

function close() {
  open.value = false
}

// `ignoreFilter` on every group: results are already filtered server-side, so Fuse
// must not re-filter them by the raw search term.
const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  // `snippet` (markdown ts_headline highlight) wins over the plain summary when the
  // card matched via a comment — rendered through AppMarkdown in #item-description.
  const cardItems: CommandPaletteItem[] = results.value.map(r => ({
    id: r.id,
    label: r.title,
    suffix: r.key,
    description: r.summary ?? undefined,
    snippet: r.matchedComment?.snippet,
    icon: 'i-lucide-square-kanban',
    onSelect: () => {
      close()
      void navigateTo(`/cards/${r.key}`)
    }
  }))

  if (term.value && !loading.value && cardItems.length === 0) {
    cardItems.push({ id: 'empty', label: 'No cards found', icon: 'i-lucide-search-x', disabled: true })
  }

  const list: CommandPaletteGroup<CommandPaletteItem>[] = [
    { id: 'cards', label: 'Cards', ignoreFilter: true, items: cardItems }
  ]

  if (term.value) {
    list.push({
      id: 'actions',
      label: 'Actions',
      ignoreFilter: true,
      items: [
        {
          id: 'view-all',
          label: `View all results for “${term.value}”`,
          icon: 'i-lucide-search',
          onSelect: () => {
            const q = term.value
            close()
            void navigateTo({ path: '/search', query: { q } })
          }
        }
      ]
    })
  }

  return list
})

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <UDashboardSearch
    v-model:open="open"
    v-model:search-term="searchTerm"
    :groups="groups"
    :color-mode="false"
    :loading="loading"
    placeholder="Search cards…"
  >
    <template #empty>
      <span class="text-sm text-muted">Type to search cards…</span>
    </template>

    <template #item-description="{ item }">
      <AppMarkdown
        v-if="item.snippet"
        :value="item.snippet"
        class="line-clamp-1 text-xs text-muted [&_p]:m-0 [&_p]:inline"
      />
      <span v-else-if="item.description" class="line-clamp-1 text-xs text-muted">{{ item.description }}</span>
    </template>
  </UDashboardSearch>
</template>
