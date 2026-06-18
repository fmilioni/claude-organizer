<script setup lang="ts">
// Shared preview↔edit field used by the card detail and the docs editor.
// Renders the value (auto-linked plain text or markdown) and, on click, swaps to
// an editor; the consumer owns the value + auto-save (this only toggles/edits).
const props = withDefaults(
  defineProps<{
    type?: 'text' | 'multiline' | 'markdown'
    placeholder?: string // empty-state hint shown in the preview
    editorPlaceholder?: string // placeholder inside the editor
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' // text/multiline input size
    rows?: number // multiline
    minHeight?: string // markdown editor
    bordered?: boolean // preview box gets a border (summary/markdown)
    inputClass?: string // typography for the input/textarea
    previewClass?: string // typography for the rendered preview
    interactive?: boolean // markdown: clickable task-list checkboxes (opt-in — out of scope for inbox)
  }>(),
  {
    type: 'markdown',
    placeholder: 'Empty. Click to edit.',
    editorPlaceholder: '',
    size: 'md',
    rows: 2,
    minHeight: '120px',
    bordered: false,
    inputClass: '',
    previewClass: '',
    interactive: false
  }
)

const model = defineModel<string>({ default: '' })
// Optional lifecycle for consumers that drive shared state off the toggle (e.g.
// the inbox list points its single auto-save buffer at whichever item is open).
const emit = defineEmits<{
  (e: 'edit-start' | 'edit-stop'): void
}>()
const editing = ref(false)
const root = ref<HTMLElement | null>(null)

function enterEdit(e: MouseEvent) {
  // let card links navigate and task-list checkboxes toggle without opening the editor
  if ((e.target as HTMLElement).closest('a, input[type="checkbox"]')) return
  editing.value = true
  emit('edit-start')
}
function stopEdit() {
  editing.value = false
  emit('edit-stop')
}
// The markdown editor has a toolbar (and link popovers), so @blur is unreliable;
// fall back to click-outside — same behavior the card description had inline.
onClickOutside(root, () => {
  if (props.type === 'markdown' && editing.value) stopEdit()
})
</script>

<template>
  <div ref="root">
    <!-- Markdown: AppMarkdown (PROSE) preview ↔ MarkdownEditor -->
    <template v-if="type === 'markdown'">
      <MarkdownEditor
        v-if="editing"
        v-model="model"
        autofocus
        :min-height="minHeight"
        :placeholder="editorPlaceholder"
      />
      <div
        v-else
        class="rounded-md px-3 py-2 cursor-text"
        :class="bordered ? 'border border-default' : ''"
        @click="enterEdit"
      >
        <AppMarkdown
          v-if="model"
          :value="model"
          :interactive="interactive"
          :class="previewClass || PROSE"
          @update:value="model = $event"
        />
        <span v-else class="text-sm text-muted/50 italic">{{ placeholder }}</span>
      </div>
    </template>

    <!-- Plain text: InlineCardText (auto-linked) preview ↔ UInput/UTextarea -->
    <template v-else>
      <UTextarea
        v-if="editing && type === 'multiline'"
        v-model="model"
        :rows="rows"
        autofocus
        :placeholder="editorPlaceholder"
        :class="['w-full', inputClass]"
        @blur="stopEdit"
      />
      <UInput
        v-else-if="editing"
        v-model="model"
        variant="ghost"
        :size="size"
        autofocus
        :placeholder="editorPlaceholder"
        :class="['w-full', inputClass]"
        @blur="stopEdit"
      />
      <div
        v-else
        class="cursor-text"
        :class="
          bordered
            ? 'rounded-md border border-default px-3 py-2 min-h-10'
            : ''
        "
        @click="enterEdit"
      >
        <InlineCardText v-if="model" :value="model" :class="previewClass" />
        <span v-else class="text-sm text-muted/50 italic">{{ placeholder }}</span>
      </div>
    </template>
  </div>
</template>
