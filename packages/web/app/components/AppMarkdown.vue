<script setup lang="ts">
import { useProjectStore } from '~/stores/project'

const props = defineProps<{
  value: string | null | undefined
}>()

const store = useProjectStore()
const router = useRouter()
const { resolveDisplaySrc } = useAttachments()

const root = ref<HTMLElement | null>(null)

const html = computed(() => {
  if (!props.value) return ''
  const rendered = renderCardMarkdown(props.value, store.currentProject?.keyPrefix ?? null)
  // Park the relative attachment src in data-att-src so the browser doesn't
  // eagerly fetch `/attachments/...` against the web origin (a guaranteed 404,
  // cross-origin); resolveImages sets the real signed src after mount.
  return rendered.replaceAll('src="/attachments/', 'data-att-src="/attachments/')
})

// The stored markdown holds the portable relative `/attachments/att_X`; the
// browser needs the absolute, auth-aware (signed) src. After each render, resolve
// every parked attachment src. v-html rebuilds the DOM on change, so we re-run on
// every html update.
async function resolveImages() {
  const el = root.value
  if (!el) return
  await Promise.all(
    Array.from(el.querySelectorAll<HTMLImageElement>('img[data-att-src]')).map(async (img) => {
      const raw = img.dataset.attSrc
      if (!raw) return
      try {
        img.src = await resolveDisplaySrc(raw)
      } catch {
        // leave it unresolved; a broken image beats throwing in render
      }
    })
  )
}

watch(html, () => nextTick(resolveImages))
onMounted(resolveImages)

// Make internal links (e.g. the auto-linked card keys) navigate via the router
// instead of doing a full page reload. External links keep default behavior.
function onClick(e: MouseEvent) {
  const anchor = (e.target as HTMLElement).closest('a')
  if (!anchor) return
  const href = anchor.getAttribute('href')
  if (href && href.startsWith('/')) {
    e.preventDefault()
    router.push(href)
  }
}
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- markdown rendered from trusted card/doc content via marked -->
  <div ref="root" @click="onClick" v-html="html" />
</template>
