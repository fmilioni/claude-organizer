<script setup lang="ts">
import type { Card } from '~/types/card'

// The rich card tile shared by the board columns and the Tasks screen: key +
// title, blocked flag, subtask/priority badges, summary and tags. The board
// renders it inside a story envelope (so it hides the parent key); standalone
// lists pass `showParentKey` to surface the `↳ PARENT` link instead. The
// `actions` slot adds per-card controls inside the card (Tasks screen).
const props = withDefaults(
  defineProps<{
    card: Card
    showParentKey?: boolean
  }>(),
  { showParentKey: false }
)

// Advisory claim: an hourglass marks a reserved card; the owner + since-when ride
// in the native title tooltip (read-only — reserving happens via MCP).
const claimHint = computed(() =>
  props.card.claim ? formatClaimHint(props.card.claim) : ''
)
</script>

<template>
  <div
    class="bg-default border border-default rounded-md px-2.5 py-2 hover:border-primary/40 transition"
  >
    <NuxtLink
      v-if="showParentKey && card.parentKey"
      :to="`/cards/${card.parentKey}`"
      class="mb-1 flex items-center gap-1 text-xs text-muted hover:underline decoration-primary/40 underline-offset-2"
      @mousedown.stop
    >
      <UIcon name="i-lucide-corner-down-right" class="size-3 shrink-0" />
      <span class="font-mono">{{ card.parentKey }}</span>
    </NuxtLink>
    <div
      v-if="card.blockedByPending"
      class="mb-1 flex items-center gap-1 text-xs text-error"
    >
      <UIcon name="i-lucide-ban" class="size-3 shrink-0" />
      <span>bloqueado</span>
    </div>
    <div class="flex items-start justify-between gap-2 min-w-0">
      <NuxtLink
        :to="`/cards/${card.key}`"
        class="text-sm leading-snug wrap-break-word min-w-0 hover:underline decoration-primary/40 underline-offset-2"
        @mousedown.stop
      >
        <span class="font-mono font-bold text-default mr-1.5">{{ card.key }}</span>
        <span class="font-medium">{{ card.title }}</span>
      </NuxtLink>
      <div class="flex shrink-0 items-center gap-1">
        <span
          v-if="card.claim"
          :title="claimHint"
          class="flex items-center text-warning"
        >
          <UIcon name="i-lucide-hourglass" class="size-3.5 shrink-0" />
        </span>
        <UBadge
          v-if="card.subtaskCount"
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-lucide-list-tree"
        >
          {{ card.subtaskDone }}/{{ card.subtaskCount }}
        </UBadge>
        <UBadge v-if="card.priority > 0" size="xs" variant="soft">
          P{{ card.priority }}
        </UBadge>
        <span
          v-if="$slots.actions"
          class="flex items-center gap-1"
          @mousedown.stop
        >
          <slot name="actions" />
        </span>
      </div>
    </div>
    <p
      v-if="card.summary"
      class="text-xs text-muted leading-snug line-clamp-3 mt-1"
    >
      {{ card.summary }}
    </p>
    <div v-if="card.tags?.length" class="flex flex-wrap gap-1 mt-1.5">
      <TagBadge
        v-for="t in card.tags"
        :key="t.id"
        :tag="t"
        size="xs"
      />
    </div>
  </div>
</template>
