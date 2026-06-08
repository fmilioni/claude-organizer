<script setup lang="ts">
import type { Tag } from '~/types/tag'
import { TAG_COLORS } from '~/types/tag'

const props = defineProps<{
  cardId: string
  projectId: string
  modelValue: Tag[]
}>()

const emit = defineEmits<{ 'update:modelValue': [tags: Tag[]] }>()

const api = useApi()

const projectTags = ref<Tag[]>([])
const search = ref('')
const open = ref(false)
const busy = ref(false)

const editingId = ref<string | null>(null)
const editName = ref('')
const editColor = ref('')

async function loadProjectTags() {
  projectTags.value = await api<Tag[]>('/tags', {
    query: { projectId: props.projectId }
  })
}

onMounted(loadProjectTags)
watch(open, (isOpen) => {
  if (isOpen) loadProjectTags()
})

const assignedIds = computed(
  () => new Set(props.modelValue.map(t => t.id))
)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return projectTags.value
  return projectTags.value.filter(t => t.name.toLowerCase().includes(q))
})

const canCreate = computed(() => {
  const q = search.value.trim()
  if (!q) return false
  return !projectTags.value.some(
    t => t.name.toLowerCase() === q.toLowerCase()
  )
})

async function addToCard(tag: Tag) {
  if (busy.value) return
  busy.value = true
  try {
    const tags = await api<Tag[]>(
      `/cards/${props.cardId}/tags/${tag.id}`,
      { method: 'POST' }
    )
    emit('update:modelValue', tags)
  } finally {
    busy.value = false
  }
}

async function removeFromCard(tag: Tag) {
  if (busy.value) return
  busy.value = true
  try {
    const tags = await api<Tag[]>(
      `/cards/${props.cardId}/tags/${tag.id}`,
      { method: 'DELETE' }
    )
    emit('update:modelValue', tags)
  } finally {
    busy.value = false
  }
}

function toggle(tag: Tag) {
  if (assignedIds.value.has(tag.id)) removeFromCard(tag)
  else addToCard(tag)
}

async function createAndAdd(color: string) {
  const name = search.value.trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    const tag = await api<Tag>('/tags', {
      method: 'POST',
      body: { projectId: props.projectId, name, color }
    })
    projectTags.value.push(tag)
    search.value = ''
    const tags = await api<Tag[]>(`/cards/${props.cardId}/tags/${tag.id}`, {
      method: 'POST'
    })
    emit('update:modelValue', tags)
  } finally {
    busy.value = false
  }
}

function startEdit(tag: Tag) {
  editingId.value = tag.id
  editName.value = tag.name
  editColor.value = tag.color
}

function cancelEdit() {
  editingId.value = null
}

// One keydown listener: two `@keydown.enter`/`@keydown.esc` on a component both
// compile to `onKeydown`, which vue-tsc rejects as a duplicate object key.
function onEditKeydown(e: KeyboardEvent, tag: Tag) {
  if (e.key === 'Enter') saveEdit(tag)
  else if (e.key === 'Escape') cancelEdit()
}

async function saveEdit(tag: Tag) {
  const name = editName.value.trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    const updated = await api<Tag>(`/tags/${tag.id}`, {
      method: 'PATCH',
      body: { name, color: editColor.value }
    })
    const idx = projectTags.value.findIndex(t => t.id === tag.id)
    if (idx !== -1) projectTags.value[idx] = updated
    if (assignedIds.value.has(tag.id)) {
      emit(
        'update:modelValue',
        props.modelValue.map(t => (t.id === tag.id ? updated : t))
      )
    }
    editingId.value = null
  } finally {
    busy.value = false
  }
}

async function deleteProjectTag(tag: Tag) {
  if (busy.value) return
  if (
    !confirm(
      `Delete tag "${tag.name}" from the whole project? It will be removed from every card.`
    )
  )
    return
  busy.value = true
  try {
    await api(`/tags/${tag.id}`, { method: 'DELETE' })
    projectTags.value = projectTags.value.filter(t => t.id !== tag.id)
    if (assignedIds.value.has(tag.id)) {
      emit(
        'update:modelValue',
        props.modelValue.filter(t => t.id !== tag.id)
      )
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <TagBadge
      v-for="t in modelValue"
      :key="t.id"
      :tag="t"
      removable
      @remove="removeFromCard(t)"
    />

    <UPopover v-model:open="open">
      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="soft"
        :label="modelValue.length ? undefined : 'Add tag'"
      />

      <template #content>
        <div class="w-64 p-2 space-y-2">
          <UInput
            v-model="search"
            placeholder="Search or create…"
            size="sm"
            autofocus
            icon="i-lucide-search"
            class="w-full"
          />

          <div class="max-h-48 overflow-y-auto space-y-0.5">
            <template v-for="t in filtered" :key="t.id">
              <div
                v-if="editingId === t.id"
                class="space-y-1.5 rounded px-2 py-1.5"
              >
                <div class="flex items-center gap-1">
                  <UInput
                    v-model="editName"
                    size="xs"
                    autofocus
                    class="flex-1"
                    @keydown="onEditKeydown($event, t)"
                  />
                  <UButton
                    icon="i-lucide-check"
                    size="xs"
                    color="primary"
                    variant="ghost"
                    @click="saveEdit(t)"
                  />
                  <UButton
                    icon="i-lucide-x"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="cancelEdit"
                  />
                </div>
                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="c in TAG_COLORS"
                    :key="c"
                    type="button"
                    class="size-4 rounded-full transition"
                    :class="
                      editColor === c
                        ? 'ring-2 ring-offset-1 ring-offset-default ring-inverted'
                        : ''
                    "
                    :style="{ backgroundColor: c }"
                    :aria-label="`Use ${c}`"
                    @click="editColor = c"
                  />
                </div>
              </div>

              <button
                v-else
                type="button"
                class="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-elevated/50"
                @click="toggle(t)"
              >
                <span
                  class="size-3 shrink-0 rounded-full"
                  :style="{ backgroundColor: t.color }"
                />
                <span class="flex-1 truncate text-sm">{{ t.name }}</span>
                <UIcon
                  name="i-lucide-pencil"
                  class="size-3.5 shrink-0 text-muted opacity-0 transition hover:text-default group-hover:opacity-100"
                  aria-label="Edit tag"
                  @click.stop="startEdit(t)"
                />
                <UIcon
                  name="i-lucide-trash-2"
                  class="size-3.5 shrink-0 text-muted opacity-0 transition group-hover:opacity-100 hover:text-error"
                  aria-label="Delete tag"
                  @click.stop="deleteProjectTag(t)"
                />
                <UIcon
                  v-if="assignedIds.has(t.id)"
                  name="i-lucide-check"
                  class="size-4 shrink-0 text-primary"
                />
              </button>
            </template>

            <p
              v-if="!filtered.length && !canCreate"
              class="px-2 py-1 text-xs text-muted"
            >
              No tags yet.
            </p>
          </div>

          <div v-if="canCreate" class="border-t border-default pt-2">
            <p class="mb-1.5 text-xs text-muted">
              Create “<span class="font-medium text-default">{{
                search.trim()
              }}</span>” with a color:
            </p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="c in TAG_COLORS"
                :key="c"
                type="button"
                class="size-5 rounded-full ring-offset-1 ring-offset-default transition hover:ring-2 hover:ring-default"
                :style="{ backgroundColor: c }"
                :aria-label="`Create with ${c}`"
                @click="createAndAdd(c)"
              />
            </div>
          </div>
        </div>
      </template>
    </UPopover>
  </div>
</template>
