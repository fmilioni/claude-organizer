<script setup lang="ts">
// Caller resolves the full body before opening (docs only carry a summary in the
// list — fetch the doc first).
const open = defineModel<boolean>('open', { default: false })
defineProps<{ title?: string | null, body?: string | null }>()

// An internal card-key link in the body navigates via the router; close so the
// user doesn't land on another page with a stale preview still mounted.
const route = useRoute()
watch(() => route.fullPath, () => {
  if (open.value) open.value = false
})
</script>

<template>
  <UModal v-model:open="open" :title="title || 'Preview'">
    <template #body>
      <AppMarkdown
        v-if="body"
        :value="body"
        :class="PROSE"
        class="max-h-[60vh] overflow-y-auto"
      />
      <p v-else class="text-sm text-muted italic">
        Empty.
      </p>
    </template>
  </UModal>
</template>
