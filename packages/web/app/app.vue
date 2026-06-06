<script setup lang="ts">
// Per-page titles render as "<page> · Claude Organizer"; pages without a title
// (or null) fall back to just the app name. Pages set their title via useHead.
useHead({
  titleTemplate: title => (title ? `${title} · Claude Organizer` : 'Claude Organizer')
})
</script>

<template>
  <UApp :tooltip="{ delayDuration: 100 }">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
