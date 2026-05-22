<script setup lang="ts">
// Renders a unified diff (the patch the capture script stored) colorized per
// line. Nuxt UI has no diff component and marked can't colorize a patch, so we
// classify each line ourselves and style it. Lines the script pruned
// (lockfiles/truncated) arrive as `# …` notes and render as muted notes.
const props = defineProps<{ diff: string }>()

type LineKind = 'file' | 'hunk' | 'add' | 'del' | 'meta' | 'note' | 'context'

const META_PREFIXES = [
  '+++',
  '---',
  'index ',
  'new file',
  'deleted file',
  'old mode',
  'new mode',
  'rename ',
  'copy ',
  'similarity ',
  'Binary files',
  'GIT binary patch'
]

function classify(text: string): LineKind {
  if (text.startsWith('diff --git ')) return 'file'
  if (text.startsWith('@@')) return 'hunk'
  if (text.startsWith('# ')) return 'note'
  if (META_PREFIXES.some(p => text.startsWith(p))) return 'meta'
  if (text.startsWith('+')) return 'add'
  if (text.startsWith('-')) return 'del'
  return 'context'
}

const lines = computed(() =>
  props.diff
    .replace(/\n$/, '')
    .split('\n')
    .map((text, i) => ({ id: i, kind: classify(text), text }))
)

const kindClass: Record<LineKind, string> = {
  file: 'text-default font-semibold bg-elevated',
  hunk: 'text-info bg-info/5',
  add: 'text-success bg-success/10',
  del: 'text-error bg-error/10',
  meta: 'text-muted',
  note: 'text-muted italic',
  context: 'text-dimmed'
}
</script>

<template>
  <div
    class="overflow-auto max-h-[480px] rounded-md border border-default bg-default text-xs font-mono leading-relaxed"
  >
    <!-- v-text (not interpolation): keeps the line's exact whitespace under
         `whitespace-pre`, with no newlines injected by the formatter. -->
    <div
      v-for="line in lines"
      :key="line.id"
      class="whitespace-pre px-3 py-px"
      :class="kindClass[line.kind]"
      v-text="line.text || ' '"
    />
  </div>
</template>
