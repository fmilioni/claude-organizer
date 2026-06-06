<script setup lang="ts">
import type { Card, CardClaim, CardStatus } from '~/types/card'
import { cardStatusOrder } from '~/types/card'

// Shared board surface used by the main Board and the sprint detail. Owns the
// column layout, the story-envelope grouping and the drag wiring. The page
// keeps the data and decides what a move means (emits below), plus any chrome
// (filters, sprint actions) and extra columns via the `trailing` slot.
const props = withDefaults(
  defineProps<{
    /** Cards for the status columns (page already applied its filters). May
     * include parent/story cards — they're rendered as envelopes, not cards. */
    cards: Card[]
    /** Sprint-less `backlog` cards for the peek column; null hides the peek. */
    backlog?: Card[] | null
    backlogClosable?: boolean
    backlogStartExpanded?: boolean
  }>(),
  { backlog: null, backlogClosable: true, backlogStartExpanded: false }
)

const emit = defineEmits<{
  (e: 'reorder', payload: { status: CardStatus, orderedIds: string[], movedId?: string }): void
  (e: 'move-to-backlog', cardId: string): void
}>()

const backlogExpanded = ref(props.backlogStartExpanded)
const blockedExpanded = ref(false)

// A card that is the parent (story) of another loaded card becomes an envelope:
// hidden from the columns, its title surfaced in the group header.
const parentIds = computed(
  () => new Set(props.cards.map(c => c.parentId).filter((id): id is string => !!id))
)
const parentTitles = computed(() => {
  const m: Record<string, string> = {}
  for (const c of props.cards) {
    if (parentIds.value.has(c.id)) m[c.key] = c.title
  }
  return m
})

// A story is rendered as an envelope, not a tile, so its own claim would have
// nowhere to show — surface it on the envelope header (keyed by the story key).
const parentClaims = computed(() => {
  const m: Record<string, CardClaim> = {}
  for (const c of props.cards) {
    if (parentIds.value.has(c.id) && c.claim) m[c.key] = c.claim
  }
  return m
})

const columns = computed<Record<CardStatus, Card[]>>(() => {
  const grouped: Record<CardStatus, Card[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    review: [],
    done: [],
    blocked: []
  }
  for (const c of props.cards) {
    if (parentIds.value.has(c.id)) continue // story envelope, not a card
    if (c.status === 'backlog') continue // backlog cards live in the peek
    grouped[c.status].push(c)
  }
  for (const status of cardStatusOrder) {
    grouped[status].sort(
      (a, b) => a.position - b.position || b.priority - a.priority
    )
  }
  return grouped
})
</script>

<template>
  <div class="flex gap-3 flex-1 min-h-0 min-w-0 overflow-x-auto">
    <template v-if="backlog">
      <BacklogColumn
        v-if="backlogExpanded"
        :cards="backlog"
        :closable="backlogClosable"
        @card-moved-to-backlog="(id: string) => emit('move-to-backlog', id)"
        @close="backlogExpanded = false"
      />
      <CollapsedColumn
        v-else
        icon="i-lucide-inbox"
        label="Backlog"
        :count="backlog.length"
        @expand="backlogExpanded = true"
      />
    </template>

    <template v-for="status in cardStatusOrder" :key="status">
      <template v-if="status === 'blocked'">
        <BoardColumn
          v-if="blockedExpanded"
          :status="status"
          :cards="columns[status]"
          group-by-story
          :parent-titles="parentTitles"
          :parent-claims="parentClaims"
          closable
          @reorder="(p: { status: CardStatus, orderedIds: string[], movedId?: string }) => emit('reorder', p)"
          @close="blockedExpanded = false"
        />
        <CollapsedColumn
          v-else
          icon="i-lucide-ban"
          label="Blocked"
          :count="columns[status].length"
          @expand="blockedExpanded = true"
        />
      </template>
      <BoardColumn
        v-else
        :status="status"
        :cards="columns[status]"
        group-by-story
        :parent-titles="parentTitles"
        @reorder="(p: { status: CardStatus, orderedIds: string[], movedId?: string }) => emit('reorder', p)"
      />
    </template>

    <slot name="trailing" />
  </div>
</template>
