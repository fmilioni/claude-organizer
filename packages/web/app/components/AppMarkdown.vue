<script setup lang="ts">
import { useProjectStore } from '~/stores/project'

const props = withDefaults(
  defineProps<{
    value: string | null | undefined
    interactive?: boolean // render task-list checkboxes clickable + emit toggles
  }>(),
  { interactive: false }
)

const emit = defineEmits<{
  (e: 'update:value', value: string): void
}>()

const store = useProjectStore()
const router = useRouter()
const { resolveDisplaySrc } = useAttachments()

const root = ref<HTMLElement | null>(null)

const html = computed(() => {
  if (!props.value) return ''
  const rendered = renderCardMarkdown(
    props.value,
    store.currentProject?.keyPrefix ?? null,
    props.interactive
  )
  // Park the relative attachment src in data-att-src so the browser doesn't
  // eagerly fetch `/attachments/...` against the web origin (a guaranteed 404,
  // cross-origin); resolveImages sets the real signed src after mount.
  return rendered.replaceAll('src="/attachments/', 'data-att-src="/attachments/')
})

// lucide image-off, inlined: the @nuxt/icon runtime doesn't render into v-html'd
// DOM, so the placeholder can't use <UIcon>.
const IMAGE_OFF_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><path d="M10.41 10.41a2 2 0 1 1-2.83-2.83"/><line x1="13.5" x2="6" y1="13.5" y2="21"/><line x1="18" x2="21" y1="12" y2="15"/><path d="M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59"/><path d="M21 15V5a2 2 0 0 0-2-2H9"/></svg>'

const PLACEHOLDER_LABEL = {
  gone: 'Image removed during attachment cleanup',
  missing: 'Image not found'
}

function makePlaceholder(kind: 'gone' | 'missing'): HTMLElement {
  const span = document.createElement('span')
  span.className
    = 'inline-flex items-center gap-1.5 align-middle rounded-md border border-dashed border-default bg-elevated px-2 py-1 text-sm text-muted'
  const icon = document.createElement('span')
  icon.className = 'shrink-0'
  icon.innerHTML = IMAGE_OFF_SVG
  const label = document.createElement('span')
  label.textContent = PLACEHOLDER_LABEL[kind]
  span.append(icon, label)
  return span
}

// The stored markdown holds the portable relative `/attachments/att_X`; the
// browser needs the absolute, auth-aware (signed) src. A failed <img> load hides
// the HTTP status, so we probe the serve URL actively with a HEAD (Fastify answers
// the GET route's HEAD with the same status and no body, so the bytes still load
// only once, via the <img>): 410 (bytes reclaimed) and 404 (row gone) become
// distinct inline placeholders, anything ok renders.
// v-html rebuilds the DOM on change, so we re-run on every html update.
async function resolveImages() {
  const el = root.value
  if (!el) return
  await Promise.all(
    Array.from(el.querySelectorAll<HTMLImageElement>('img[data-att-src]')).map(async (img) => {
      const raw = img.dataset.attSrc
      if (!raw) return
      let url: string
      try {
        url = await resolveDisplaySrc(raw)
      } catch (err) {
        // The url-minting endpoint 404s when the row is gone; other failures are
        // transient — leave the image unresolved rather than mislabel it.
        if ((err as { statusCode?: number }).statusCode === 404) {
          img.replaceWith(makePlaceholder('missing'))
        }
        return
      }
      let res: Response
      try {
        res = await fetch(url, { method: 'HEAD', credentials: 'include' })
      } catch {
        return
      }
      if (res.ok) img.src = url
      else if (res.status === 410) img.replaceWith(makePlaceholder('gone'))
      else if (res.status === 404) img.replaceWith(makePlaceholder('missing'))
    })
  )
}

watch(html, () => nextTick(resolveImages))
onMounted(resolveImages)

// Make internal links (e.g. the auto-linked card keys) navigate via the router
// instead of doing a full page reload. External links keep default behavior.
function onClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (props.interactive && props.value != null) {
    const box = target.closest<HTMLInputElement>(
      'input[type="checkbox"][data-task-index]'
    )
    if (box) {
      // preventDefault keeps the DOM in sync with the source: the re-render off
      // the emitted value owns the checked state, not the native toggle.
      e.preventDefault()
      const index = Number(box.dataset.taskIndex)
      if (Number.isInteger(index)) {
        emit('update:value', toggleTaskMarker(props.value, index))
      }
      return
    }
  }
  const anchor = target.closest('a')
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
