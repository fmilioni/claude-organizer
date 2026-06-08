<script setup lang="ts">
import { useProjectStore } from '~/stores/project'
import type { CardSearchResult } from '~/types/card'

const store = useProjectStore()
const api = useApi()

const query = ref('')
const results = ref<CardSearchResult[]>([])
const loading = ref(false)
const focused = ref(false)

const term = computed(() => query.value.trim())
const showPanel = computed(() => focused.value && term.value.length > 0)

// A monotonic ticket discards out-of-order responses: a slow early request must
// not overwrite the results of a later, faster one.
let ticket = 0
let timer: ReturnType<typeof setTimeout> | undefined
let blurTimer: ReturnType<typeof setTimeout> | undefined

watch(term, (value) => {
  if (timer) clearTimeout(timer)
  if (!value) {
    // Bump the ticket so an already-fired in-flight request can't write back.
    ticket++
    results.value = []
    loading.value = false
    return
  }
  // Typing implies focus. After picking a result, `@mousedown.prevent` keeps DOM
  // focus on the input, so `@focus` won't re-fire on the next search — without
  // this, `showPanel` would stay false and the panel never reopens.
  focused.value = true
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
    const data = await api<CardSearchResult[]>('/cards', {
      query: { projectId, q: value }
    })
    if (mine !== ticket) return
    results.value = data
  } catch {
    if (mine === ticket) results.value = []
  } finally {
    if (mine === ticket) loading.value = false
  }
}

function goToSearchPage() {
  const q = term.value
  if (!q) return
  reset()
  void navigateTo({ path: '/search', query: { q } })
}

function goTo(result: CardSearchResult) {
  reset()
  void navigateTo(`/cards/${result.key}`)
}

function reset() {
  query.value = ''
  results.value = []
  focused.value = false
}

// Delay the close so a mousedown on a result is handled before the panel unmounts.
function onBlur() {
  blurTimer = setTimeout(() => {
    focused.value = false
  }, 150)
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  if (blurTimer) clearTimeout(blurTimer)
})

// One keydown listener: two `@keydown.*` on a component both compile to
// `onKeydown`, which vue-tsc rejects as a duplicate object key.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') goToSearchPage()
  else if (e.key === 'Escape') reset()
}
</script>

<template>
  <div class="relative">
    <UInput
      v-model="query"
      icon="i-lucide-search"
      placeholder="Search cards…"
      size="sm"
      autocomplete="off"
      :loading="loading"
      class="w-full"
      @focus="focused = true"
      @blur="onBlur"
      @keydown="onKeydown"
    />

    <div
      v-if="showPanel"
      role="listbox"
      aria-label="Card search results"
      class="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-md border border-default bg-default shadow-lg"
    >
      <p
        v-if="!loading && results.length === 0"
        class="px-3 py-2 text-sm text-muted"
      >
        No cards found.
      </p>
      <div
        v-for="r in results"
        :key="r.id"
        role="option"
        tabindex="-1"
        class="block w-full cursor-pointer border-b border-default px-3 py-2 last:border-0 hover:bg-elevated"
        @mousedown.prevent="goTo(r)"
      >
        <AppCardResultRow :result="r" />
        <AppMarkdown
          v-if="r.matchedComment"
          :value="r.matchedComment.snippet"
          class="mt-0.5 line-clamp-2 text-xs text-muted [&_p]:m-0 [&_p]:inline"
        />
      </div>
    </div>
  </div>
</template>
