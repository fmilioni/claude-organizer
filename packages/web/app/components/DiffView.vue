<script setup lang="ts">
// Renders a unified diff GitHub-style: one block per file (path on the left,
// +adds / −dels on the right), a line-number gutter (old | new) per row, the
// git noise (mode/index/---/+++) stripped and @@ shown only as a subtle hunk
// separator. Nuxt UI has no diff component and marked can't colorize a patch,
// so we parse it ourselves. Lines pruned by the capture script
// (lockfiles/truncated/binary) surface as a muted note on the file block.
const props = defineProps<{ diff: string }>()

type LineKind = 'add' | 'del' | 'context' | 'hunk'
interface DiffLine {
  kind: LineKind
  text: string
  oldNo: number | null
  newNo: number | null
}
interface DiffFile {
  path: string
  additions: number
  deletions: number
  note: string | null
  lines: DiffLine[]
}

// Git metadata lines we don't surface (the file block header replaces them).
const META_PREFIXES = [
  'index ',
  'new file',
  'deleted file',
  'old mode',
  'new mode',
  'rename ',
  'copy ',
  'similarity ',
  'dissimilarity '
]

const files = computed<DiffFile[]>(() => {
  const out: DiffFile[] = []
  let cur: DiffFile | null = null
  let oldNo = 0
  let newNo = 0
  const flush = () => {
    if (cur) out.push(cur)
  }
  for (const raw of props.diff.replace(/\n$/, '').split('\n')) {
    if (raw.startsWith('diff --git ')) {
      flush()
      const m = raw.match(/^diff --git a\/(.+) b\/(.+)$/)
      cur = {
        path: m ? m[2]! : raw.slice('diff --git '.length),
        additions: 0,
        deletions: 0,
        note: null,
        lines: []
      }
      oldNo = 0
      newNo = 0
      continue
    }
    if (!cur) continue
    if (raw.startsWith('+++ b/')) {
      cur.path = raw.slice('+++ b/'.length)
      continue
    }
    if (raw.startsWith('+++ ') || raw.startsWith('--- ')) continue
    if (META_PREFIXES.some(p => raw.startsWith(p))) continue
    if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) {
      cur.note = 'Binary file — diff not shown'
      continue
    }
    // Notes the capture script wrote in place of a pruned/truncated body.
    if (raw.startsWith('# ')) {
      cur.note = raw.slice(2)
      continue
    }
    if (raw.startsWith('@@')) {
      const hm = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (hm) {
        oldNo = Number(hm[1])
        newNo = Number(hm[2])
      }
      cur.lines.push({ kind: 'hunk', text: raw, oldNo: null, newNo: null })
      continue
    }
    if (raw.startsWith('+')) {
      cur.additions++
      cur.lines.push({ kind: 'add', text: raw, oldNo: null, newNo })
      newNo++
      continue
    }
    if (raw.startsWith('-')) {
      cur.deletions++
      cur.lines.push({ kind: 'del', text: raw, oldNo, newNo: null })
      oldNo++
      continue
    }
    cur.lines.push({ kind: 'context', text: raw, oldNo, newNo })
    oldNo++
    newNo++
  }
  flush()
  return out
})

const rowClass: Record<Exclude<LineKind, 'hunk'>, string> = {
  add: 'bg-success/10 text-success',
  del: 'bg-error/10 text-error',
  context: 'text-dimmed'
}

// The trailing context after `@@ -a,b +c,d @@` (often a function signature); the
// line numbers themselves live in the gutter, so the raw `@@` is hidden.
function hunkContext(text: string): string {
  return text.match(/^@@ .*? @@ ?(.*)$/)?.[1] ?? ''
}
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="(file, fi) in files"
      :key="fi"
      class="rounded-md border border-default overflow-hidden"
    >
      <div
        class="flex items-center justify-between gap-3 px-3 py-1.5 bg-elevated border-b border-default"
      >
        <span class="font-mono text-xs break-all">{{ file.path }}</span>
        <span class="flex items-center gap-1.5 shrink-0 font-mono text-xs">
          <span
            v-if="file.additions"
            class="text-success bg-success/10 rounded px-1"
          >+{{ file.additions }}</span>
          <span
            v-if="file.deletions"
            class="text-error bg-error/10 rounded px-1"
          >-{{ file.deletions }}</span>
        </span>
      </div>

      <div v-if="file.lines.length" class="text-xs font-mono leading-relaxed">
        <template v-for="(line, li) in file.lines" :key="li">
          <div
            v-if="line.kind === 'hunk'"
            class="px-3 py-0.5 bg-elevated/40 text-muted text-[11px] truncate border-t border-default first:border-t-0"
            v-text="hunkContext(line.text)"
          />
          <div v-else class="flex" :class="rowClass[line.kind]">
            <span
              class="shrink-0 w-9 px-1 text-right text-muted/40 select-none tabular-nums"
            >{{ line.oldNo ?? "" }}</span>
            <span
              class="shrink-0 w-9 px-1 text-right text-muted/40 select-none tabular-nums border-r border-default"
            >{{ line.newNo ?? "" }}</span>
            <span
              class="flex-1 min-w-0 whitespace-pre-wrap break-all pl-2 pr-3"
              v-text="line.text || ' '"
            />
          </div>
        </template>
      </div>

      <div
        v-if="file.note"
        class="px-3 py-1.5 text-xs text-muted italic"
        v-text="file.note"
      />
    </div>
  </div>
</template>
