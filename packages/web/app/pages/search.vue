<script setup lang="ts">
import { useProjectStore } from '~/stores/project'
import type { CardSearchResult } from '~/types/card'

const route = useRoute()
const router = useRouter()
const store = useProjectStore()
const { currentProject, currentProjectId } = storeToRefs(store)
const api = useApi()

useHead({ title: 'Search' })

const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const results = ref<CardSearchResult[]>([])
const loading = ref(false)
const searched = ref(false)

const term = computed(() => query.value.trim())

// A monotonic ticket discards out-of-order responses (same guard as AppCardSearch).
let ticket = 0
let timer: ReturnType<typeof setTimeout> | undefined

async function runSearch() {
  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }
  const value = term.value
  const projectId = currentProjectId.value
  if (!value || !projectId) {
    ticket++
    results.value = []
    loading.value = false
    searched.value = false
    return
  }
  const mine = ++ticket
  loading.value = true
  try {
    const data = await api<CardSearchResult[]>('/cards', {
      query: { projectId, q: value }
    })
    if (mine !== ticket) return
    results.value = data
    searched.value = true
  } catch {
    if (mine === ticket) {
      results.value = []
      searched.value = true
    }
  } finally {
    if (mine === ticket) loading.value = false
  }
}

// Initial render + project becoming ready / switching: search now (no debounce)
// so a deep-linked /search?q=… paints as soon as the project resolves.
useProjectData(currentProjectId, runSearch, { watch: [currentProjectId] })

// Typing: keep the URL live in sync, debounce the search.
watch(term, (value) => {
  void router.replace({ query: value ? { q: value } : {} })
  if (timer) clearTimeout(timer)
  if (!value) {
    ticket++
    results.value = []
    loading.value = false
    searched.value = false
    return
  }
  loading.value = true
  timer = setTimeout(() => void runSearch(), 250)
})

// Header Enter navigates here with ?q=…; while the page is already mounted that
// only changes the route, so mirror it back into the input.
watch(() => route.query.q, (q) => {
  const next = typeof q === 'string' ? q : ''
  if (next !== query.value) query.value = next
})

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <UDashboardPanel id="search">
    <template #header>
      <UDashboardNavbar title="Search">
        <template #leading>
          <UIcon name="i-lucide-search" class="text-primary" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4">
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search cards…"
          autocomplete="off"
          autofocus
          :loading="loading"
          class="max-w-2xl"
        />

        <div v-if="!currentProject" class="text-sm text-muted">
          Pick or create a project in the sidebar.
        </div>

        <template v-else>
          <p v-if="!term" class="text-sm text-muted">
            Type to search cards by key, title, summary or comments.
          </p>

          <p
            v-else-if="searched && !loading && results.length === 0"
            class="text-sm text-muted"
          >
            No cards found for "{{ term }}".
          </p>

          <ul v-else class="divide-y divide-default">
            <li v-for="r in results" :key="r.id">
              <NuxtLink
                :to="`/cards/${r.key}`"
                class="block rounded-md px-2 py-3 hover:bg-elevated"
              >
                <AppCardResultRow :result="r" prominent />
              </NuxtLink>
            </li>
          </ul>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
