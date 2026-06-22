<script setup lang="ts">
const props = defineProps<{ id: string, label: string }>()
const emit = defineEmits<{ loaded: [{ bytes: number }] }>()

const { resolveDisplay } = useAttachments()

type State = 'loading' | 'ok' | 'gone' | 'missing'
const state = ref<State>('loading')
const src = ref<string | null>(null)

// Same probe AppMarkdown uses: a failed <img> load hides the HTTP status, so HEAD
// the signed serve URL to tell 410 (bytes reclaimed on cleanup) from 404 (row
// gone) — the GET route answers HEAD with the same status and no body, so the
// bytes still load only once via the <img>.
async function load() {
  state.value = 'loading'
  src.value = null
  let meta: Awaited<ReturnType<typeof resolveDisplay>>
  try {
    meta = await resolveDisplay(props.id)
  } catch (err) {
    // The url-minting endpoint 404s only when the row is gone; anything else is
    // transient — stay in loading rather than mislabel it.
    if ((err as { statusCode?: number }).statusCode === 404) state.value = 'missing'
    return
  }
  let res: Response
  try {
    res = await fetch(meta.url, { method: 'HEAD', credentials: 'include' })
  } catch {
    return
  }
  if (res.ok) {
    src.value = meta.url
    state.value = 'ok'
    if (meta.byteSize != null) emit('loaded', { bytes: meta.byteSize })
  } else if (res.status === 410) {
    state.value = 'gone'
  } else if (res.status === 404) {
    state.value = 'missing'
  }
}

watch(() => props.id, load, { immediate: true })
</script>

<template>
  <figure class="min-w-0 space-y-1">
    <figcaption class="font-mono text-[11px] text-muted">
      {{ label }}
    </figcaption>
    <img
      v-if="state === 'ok' && src"
      :src="src"
      :alt="label"
      class="max-h-72 max-w-full rounded border border-default object-contain"
    >
    <div
      v-else-if="state === 'gone' || state === 'missing'"
      class="inline-flex items-center gap-1.5 rounded-md border border-dashed border-default bg-elevated px-2 py-1 text-xs text-muted"
    >
      <UIcon name="i-lucide-image-off" class="size-3.5 shrink-0" />
      <span>{{ state === 'gone' ? 'Image removed during attachment cleanup' : 'Image not found' }}</span>
    </div>
    <div
      v-else
      class="h-24 w-32 animate-pulse rounded border border-default bg-elevated"
    />
  </figure>
</template>
