<script setup lang="ts">
import type { EditorToolbarItem } from '@nuxt/ui'

// Reusable markdown editor (TipTap via UEditor): the standard toolbar + shared
// PROSE typography, so the editor matches the rendered <AppMarkdown> preview.
// Toggle/save behavior (click-to-edit, pencil, Save/Cancel) lives in the consumer.
withDefaults(
  defineProps<{
    placeholder?: string
    autofocus?: boolean
    minHeight?: string
  }>(),
  { placeholder: '', autofocus: false, minHeight: '120px' }
)

const model = defineModel<string>({ default: '' })

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
