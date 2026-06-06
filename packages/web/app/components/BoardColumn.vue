<script setup lang="ts">
import type { Card, CardClaim, CardStatus } from '~/types/card'
import { cardStatusMeta } from '~/types/card'

const props = withDefaults(
  defineProps<{
    status: CardStatus
    cards: Card[]
    closable?: boolean
    /** Group child cards under their story (envelope), Jira-style. */
    groupByStory?: boolean
    /** parentKey -> story title, for the envelope headers. */
    parentTitles?: Record<string, string>
    /** parentKey -> the story's own claim, for the envelope reservation hint. */
    parentClaims?: Record<string, CardClaim>
  }>(),
  { groupByStory: false, parentTitles: () => ({}), parentClaims: () => ({}) }
)

const emit = defineEmits<{
  (e: 'reorder', payload: { status: CardStatus, orderedIds: string[], movedId?: string }): void
  (e: 'close'): void
}>()

const meta = computed(() => cardStatusMeta[props.status])
</script>

<template>
  <div
    class="flex flex-col bg-elevated/40 rounded-lg border border-default overflow-hidden h-full"
    style="flex: 1 1 0; min-width: 200px;"
  >
    <div
      class="flex items-center justify-between px-3 py-2 border-b border-default shrink-0"
    >
      <div class="flex items-center gap-2">
        <UBadge :color="meta.color" variant="subtle" size="sm">
          {{ meta.label }}
        </UBadge>
        <span class="text-xs text-muted">{{ cards.length }}</span>
      </div>
      <UButton
        v-if="closable"
        icon="i-lucide-x"
        size="xs"
        color="neutral"
        variant="ghost"
        @click="emit('close')"
      />
    </div>

    <CardDraggableList
      :status="status"
      :cards="cards"
      :group-by-story="groupByStory"
      :parent-titles="parentTitles"
      :parent-claims="parentClaims"
      @reorder="(p) => emit('reorder', p)"
    />
  </div>
</template>
