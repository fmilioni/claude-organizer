<script setup lang="ts">
import type { EditorToolbarItem } from '@nuxt/ui'

import type { AttachmentOwner } from '~/composables/useAttachments'

// Reusable markdown editor (TipTap via UEditor): the standard toolbar + shared
// PROSE typography, so the editor matches the rendered <AppMarkdown> preview.
// Toggle/save behavior (click-to-edit, pencil, Save/Cancel) lives in the consumer.
//
// Paste/drop of an image file uploads it (CO-258) and inserts an image node whose
// `src` is the portable `/attachments/att_X` path. `owner` binds the upload to its
// entity (card/doc); an absent owner uploads unowned.
const props = withDefaults(
  defineProps<{
    placeholder?: string
    autofocus?: boolean
    minHeight?: string
    owner?: AttachmentOwner | null
  }>(),
  { placeholder: '', autofocus: false, minHeight: '120px', owner: undefined }
)

// Emitted with the uploaded attachment id so a composer without an entity id yet
// (new comment / inbox) can bind the owner on submit or discard it on abandon.
const emit = defineEmits<{ (e: 'uploaded', id: string): void }>()

const model = defineModel<string>({ default: '' })

const toast = useToast()
const { uploadImage, resolveDisplaySrc } = useAttachments()

// Minimal structural shapes for the ProseMirror view the paste/drop handlers get.
// Methods (not arrow props) so param checks stay bivariant — the real EditorView
// then satisfies these without pulling ProseMirror types into the web package.
interface PmNode { create(attrs: Record<string, unknown>): unknown }
interface PmTr {
  insert(pos: number, node: unknown): PmTr
  replaceSelectionWith(node: unknown, inheritMarks?: boolean): PmTr
}
interface PmView {
  state: {
    schema: { nodes: Record<string, PmNode | undefined> }
    selection: { from: number }
    tr: PmTr
    doc: { content: { size: number } }
  }
  dispatch(tr: PmTr): void
  posAtCoords(coords: { left: number, top: number }): { pos: number } | null
}

function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = Array.from(data.files)
  if (files.length) return files.filter(f => f.type.startsWith('image/'))
  // Some browsers expose a pasted screenshot only through `items`, not `files`.
  return Array.from(data.items)
    .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
    .map(it => it.getAsFile())
    .filter((f): f is File => f != null)
}

function insertImage(view: PmView, src: string, pos?: number) {
  const node = view.state.schema.nodes.image?.create({ src })
  if (!node) return
  const tr = pos == null
    ? view.state.tr.replaceSelectionWith(node, false)
    : view.state.tr.insert(Math.min(pos, view.state.doc.content.size), node)
  try {
    view.dispatch(tr)
  } catch {
    // The editor was torn down mid-upload (consumer left edit mode); drop silently.
  }
}

// Sequential so multiple files keep their order; each inserts at the caret.
async function uploadAndInsert(view: PmView, files: File[], pos?: number) {
  for (const file of files) {
    try {
      const { id, url } = await uploadImage(file, props.owner ?? null)
      insertImage(view, url, pos)
      emit('uploaded', id)
    } catch (e) {
      toast.add({
        title: 'Image upload failed',
        description: resolveError(e),
        color: 'error'
      })
    }
  }
}

const editorProps = {
  handlePaste(view: PmView, event: ClipboardEvent): boolean {
    const files = imageFilesFrom(event.clipboardData)
    if (!files.length) return false
    event.preventDefault()
    uploadAndInsert(view, files)
    return true
  },
  handleDrop(view: PmView, event: DragEvent): boolean {
    const files = imageFilesFrom(event.dataTransfer)
    if (!files.length) return false
    event.preventDefault()
    const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
    uploadAndInsert(view, files, at?.pos)
    return true
  },
  // The node attr `src` stays the portable relative path (markdown serializes from
  // it); the rendered <img> gets the resolved, auth-aware absolute src.
  nodeViews: {
    image(node: { attrs: { src?: string, alt?: string } }) {
      const dom = document.createElement('img')
      dom.draggable = false
      if (node.attrs.alt) dom.alt = node.attrs.alt
      const src = node.attrs.src
      if (src) {
        resolveDisplaySrc(src)
          .then((resolved) => {
            dom.src = resolved
          })
          .catch(() => {})
      }
      // The async `src` set is a DOM mutation ProseMirror would otherwise read back
      // into the doc; ignore it so it doesn't redraw or revert the node.
      return { dom, ignoreMutation: () => true }
    }
  }
}

const toolbarItems: EditorToolbarItem[] = [
  { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold' },
  { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic' },
  { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough' },
  { kind: 'mark', mark: 'code', icon: 'i-lucide-code' },
  { kind: 'heading', level: 2, icon: 'i-lucide-heading-2' },
  { kind: 'heading', level: 3, icon: 'i-lucide-heading-3' },
  { kind: 'bulletList', icon: 'i-lucide-list' },
  { kind: 'orderedList', icon: 'i-lucide-list-ordered' },
  { kind: 'blockquote', icon: 'i-lucide-quote' },
  { kind: 'codeBlock', icon: 'i-lucide-code-2' },
  { kind: 'link', icon: 'i-lucide-link' },
  { kind: 'horizontalRule', icon: 'i-lucide-minus' },
  { kind: 'undo', icon: 'i-lucide-undo' },
  { kind: 'redo', icon: 'i-lucide-redo' }
]
</script>

<template>
  <div class="border border-default rounded-md overflow-hidden">
    <UEditor
      v-slot="{ editor }"
      v-model="model"
      content-type="markdown"
      :autofocus="autofocus ? 'end' : false"
      :placeholder="placeholder"
      :editor-props="editorProps"
      :style="{ minHeight }"
      :ui="{ base: `px-3! py-2 [&_[data-type=horizontalRule]]:my-4! [&_[data-type=horizontalRule]]:py-0! [&_[data-type=horizontalRule]_hr]:my-0 ${PROSE}` }"
    >
      <UEditorToolbar
        :editor="editor"
        :items="toolbarItems"
        class="border-b border-default bg-elevated/30"
      />
    </UEditor>
  </div>
</template>
