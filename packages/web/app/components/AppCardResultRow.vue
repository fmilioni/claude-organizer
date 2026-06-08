<script setup lang="ts">
import type { CardSearchResult } from '~/types/card'

withDefaults(defineProps<{ result: CardSearchResult, prominent?: boolean }>(), {
  prominent: false
})
</script>

<template>
  <div class="flex min-w-0 items-center gap-2">
    <span class="shrink-0 whitespace-nowrap font-mono text-xs text-muted">{{ result.key }}</span>
    <span
      class="font-medium"
      :class="prominent ? 'text-base' : 'truncate text-sm'"
    >{{ result.title }}</span>
  </div>
  <p
    v-if="result.summary"
    class="text-muted"
    :class="prominent ? 'mt-0.5 line-clamp-2 text-sm' : 'truncate text-xs'"
  >
    {{ result.summary }}
  </p>
</template>
