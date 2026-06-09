<script setup lang="ts">
import type { Project } from '@claude-organizer/shared'

import { useProjectStore } from '~/stores/project'
import type { Card, CardStatus } from '~/types/card'
import { cardStatusMeta, cardStatusOrder } from '~/types/card'
import type { Sprint } from '~/types/sprint'

const store = useProjectStore()
const { projects, currentProject, currentProjectId } = storeToRefs(store)
const api = useApi()

useHead({ title: 'Home' })

const { data: activeSprint, refresh: refreshSprint } = useActiveSprint(
  () => currentProjectId.value
)

const sprints = ref<Sprint[]>([])
const sprintCards = ref<Card[]>([])

async function loadDashboard() {
  const projectId = currentProjectId.value
  if (!projectId) {
    sprints.value = []
    sprintCards.value = []
    return
  }
  const [sprintList, cardList] = await Promise.all([
    api<Sprint[]>('/sprints', { query: { projectId } }),
    activeSprint.value
      ? api<Card[]>('/cards', {
          query: { projectId, sprintId: activeSprint.value.id }
        })
      : Promise.resolve<Card[]>([])
  ])
  sprints.value = sprintList
  sprintCards.value = cardList
}

useProjectData(currentProjectId, loadDashboard, {
  watch: [currentProjectId, activeSprint],
  onEvent: (event) => {
    if (event.type === 'sprint.changed' || event.type === 'sprint.deleted') {
      refreshSprint()
    } else if (
      event.type === 'card.changed'
      || event.type === 'card.deleted'
    ) {
      loadDashboard()
    } else if (
      event.type === 'project.changed'
      || event.type === 'project.deleted'
    ) {
      // a project was renamed, archived or destroyed — refresh both lists (the
      // store falls back to another project if the current one is gone).
      refreshProjectLists()
      loadDashboard()
    }
  }
})

// --- Project management (archive / restore / destroy) ---

const archivedProjects = ref<Project[]>([])

async function loadArchivedProjects() {
  archivedProjects.value = await api<Project[]>('/projects', {
    query: { archivedOnly: 'true' }
  })
}

async function refreshProjectLists() {
  await Promise.all([store.loadProjects(), loadArchivedProjects()])
  // If the current project was archived/destroyed, repoint to another one.
  if (!currentProject.value && projects.value[0]) {
    store.setCurrent(projects.value[0].slug)
  }
}

onMounted(loadArchivedProjects)

async function archiveProject(id: string) {
  await api(`/projects/${id}/archive`, { method: 'POST' })
  await refreshProjectLists()
}

async function restoreProject(id: string) {
  await api(`/projects/${id}/restore`, { method: 'POST' })
  await refreshProjectLists()
}

const destroyOpen = ref(false)
const destroyTarget = ref<Project | null>(null)
const destroyConfirm = ref('')

const destroyArmed = computed(
  () => !!destroyTarget.value && destroyConfirm.value === destroyTarget.value.slug
)

function openDestroy(project: Project) {
  destroyTarget.value = project
  destroyConfirm.value = ''
  destroyOpen.value = true
}

async function confirmDestroy() {
  const target = destroyTarget.value
  if (!target || !destroyArmed.value) return
  await api(`/projects/${target.id}`, {
    method: 'DELETE',
    body: { confirmSlug: destroyConfirm.value }
  })
  destroyOpen.value = false
  destroyTarget.value = null
  destroyConfirm.value = ''
  await refreshProjectLists()
}

const statusCounts = computed<Record<CardStatus, number>>(() => {
  const counts: Record<CardStatus, number> = {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    review: 0,
    done: 0,
    blocked: 0
  }
  for (const c of sprintCards.value) counts[c.status]++
  return counts
})

const totalSprintCards = computed(() => sprintCards.value.length)
const doneSprintCards = computed(() => statusCounts.value.done)
const sprintProgress = computed(() =>
  totalSprintCards.value
    ? Math.round((doneSprintCards.value / totalSprintCards.value) * 100)
    : 0
)

const sprintsByStatus = computed(() => ({
  active: sprints.value.filter(s => s.status === 'active').length,
  planned: sprints.value.filter(s => s.status === 'planned').length,
  completed: sprints.value.filter(s => s.status === 'completed').length
}))

const stats = computed<{ label: string, value: string | number, icon: string }[]>(
  () => [
    { label: 'Projects', value: projects.value.length, icon: 'i-lucide-folders' },
    { label: 'Sprints', value: sprints.value.length, icon: 'i-lucide-timer' },
    {
      label: 'Tasks in sprint',
      value: totalSprintCards.value,
      icon: 'i-lucide-list-checks'
    },
    {
      label: 'Completion',
      value: `${sprintProgress.value}%`,
      icon: 'i-lucide-circle-check-big'
    }
  ]
)
</script>

<template>
  <UDashboardPanel id="home">
    <template #header>
      <UDashboardNavbar title="Home">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UIcon name="i-lucide-home" class="text-primary" />
        </template>
        <template #right>
          <UBadge v-if="currentProject" color="neutral" variant="subtle">
            {{ currentProject.name }}
          </UBadge>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 sm:gap-6">
        <div v-if="!currentProject" class="text-center text-muted py-8">
          Pick or create a project in the sidebar.
        </div>
        <template v-else>
          <!-- Stat cards -->
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <UCard v-for="stat in stats" :key="stat.label">
              <div class="flex items-center gap-3">
                <div class="rounded-lg bg-elevated p-2.5">
                  <UIcon :name="stat.icon" class="text-xl text-primary" />
                </div>
                <div class="min-w-0">
                  <p class="text-2xl font-semibold tabular-nums">
                    {{ stat.value }}
                  </p>
                  <p class="text-sm text-muted truncate">
                    {{ stat.label }}
                  </p>
                </div>
              </div>
            </UCard>
          </div>

          <div class="grid gap-4 sm:gap-6 lg:grid-cols-3">
            <!-- Active sprint -->
            <UCard class="lg:col-span-2">
              <template #header>
                <div class="flex items-center justify-between gap-2">
                  <span class="font-medium truncate">
                    {{ activeSprint ? activeSprint.name : 'Active sprint' }}
                  </span>
                  <UBadge v-if="activeSprint" color="info" variant="subtle">
                    active
                  </UBadge>
                </div>
              </template>

              <div v-if="!activeSprint" class="text-sm text-muted py-4 text-center">
                No active sprint. Start one from
                <NuxtLink to="/sprints" class="text-primary hover:underline">Sprints</NuxtLink>.
              </div>

              <div v-else class="space-y-4">
                <div>
                  <div class="flex items-center justify-between text-sm mb-1.5">
                    <span class="text-muted">
                      {{ doneSprintCards }} / {{ totalSprintCards }} done
                    </span>
                    <span class="font-medium tabular-nums">{{ sprintProgress }}%</span>
                  </div>
                  <UProgress
                    :model-value="doneSprintCards"
                    :max="Math.max(totalSprintCards, 1)"
                    color="primary"
                  />
                </div>

                <div class="flex flex-wrap gap-2">
                  <UBadge
                    v-for="status in cardStatusOrder"
                    :key="status"
                    :color="cardStatusMeta[status].color"
                    variant="subtle"
                  >
                    {{ cardStatusMeta[status].label }}: {{ statusCounts[status] }}
                  </UBadge>
                </div>
              </div>
            </UCard>

            <!-- Sprints breakdown -->
            <UCard>
              <template #header>
                <span class="font-medium">Sprints</span>
              </template>
              <dl class="space-y-3">
                <div class="flex items-center justify-between">
                  <dt class="text-sm text-muted flex items-center gap-2">
                    <UIcon name="i-lucide-play" class="text-info" /> Active
                  </dt>
                  <dd class="font-medium tabular-nums">
                    {{ sprintsByStatus.active }}
                  </dd>
                </div>
                <div class="flex items-center justify-between">
                  <dt class="text-sm text-muted flex items-center gap-2">
                    <UIcon name="i-lucide-clock" class="text-muted" /> Planned
                  </dt>
                  <dd class="font-medium tabular-nums">
                    {{ sprintsByStatus.planned }}
                  </dd>
                </div>
                <div class="flex items-center justify-between">
                  <dt class="text-sm text-muted flex items-center gap-2">
                    <UIcon name="i-lucide-check" class="text-success" /> Completed
                  </dt>
                  <dd class="font-medium tabular-nums">
                    {{ sprintsByStatus.completed }}
                  </dd>
                </div>
              </dl>
            </UCard>
          </div>
        </template>

        <!-- Projects management -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-folders" class="text-primary" />
              <span class="font-medium">Projects</span>
            </div>
          </template>

          <div class="space-y-2">
            <div
              v-for="p in projects"
              :key="p.id"
              class="border border-default rounded-md px-3 py-2 flex items-center gap-3"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm truncate">{{ p.name }}</span>
                  <UBadge
                    v-if="p.id === currentProjectId"
                    size="xs"
                    variant="subtle"
                    color="primary"
                  >
                    current
                  </UBadge>
                </div>
                <p class="text-xs text-muted font-mono truncate">
                  {{ p.slug }}
                </p>
              </div>
              <UButton
                icon="i-lucide-archive"
                size="xs"
                color="neutral"
                variant="ghost"
                label="Archive"
                @click="archiveProject(p.id)"
              />
              <UButton
                icon="i-lucide-trash-2"
                size="xs"
                color="error"
                variant="ghost"
                label="Destroy"
                @click="openDestroy(p)"
              />
            </div>
          </div>

          <ArchivedDisclosure
            v-if="archivedProjects.length"
            :count="archivedProjects.length"
            label="Archived projects"
            class="mt-3"
          >
            <div class="space-y-2">
              <div
                v-for="p in archivedProjects"
                :key="p.id"
                class="border border-dashed border-default rounded-md px-3 py-2 flex items-center gap-3"
              >
                <div class="flex-1 min-w-0">
                  <span class="font-medium text-sm text-muted">{{ p.name }}</span>
                  <span class="text-xs text-muted font-mono ml-2">{{ p.slug }}</span>
                </div>
                <UButton
                  icon="i-lucide-archive-restore"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  label="Restore"
                  @click="restoreProject(p.id)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  color="error"
                  variant="ghost"
                  label="Destroy"
                  @click="openDestroy(p)"
                />
              </div>
            </div>
          </ArchivedDisclosure>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <UModal
    v-model:open="destroyOpen"
    :title="`Destroy ${destroyTarget?.name ?? 'project'}`"
  >
    <template #body>
      <div class="space-y-3">
        <p class="text-sm">
          This permanently deletes
          <strong>{{ destroyTarget?.name }}</strong> and everything in it —
          sprints, cards, docs, tags and comments. This cannot be undone.
        </p>
        <UFormField
          :label="`Type the slug to confirm: ${destroyTarget?.slug ?? ''}`"
        >
          <UInput
            v-model="destroyConfirm"
            :placeholder="destroyTarget?.slug"
            autocomplete="off"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton variant="ghost" label="Cancel" @click="destroyOpen = false" />
        <UButton
          color="error"
          label="Destroy"
          :disabled="!destroyArmed"
          @click="confirmDestroy"
        />
      </div>
    </template>
  </UModal>
</template>
