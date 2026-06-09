<script setup lang="ts">
import type { Project } from '@claude-organizer/shared'

import { useProjectStore } from '~/stores/project'

const store = useProjectStore()
const { currentProject } = storeToRefs(store)
const api = useApi()
const toast = useToast()
const apiUrl = (useRuntimeConfig().public.apiUrl as string).replace(/\/$/, '')

useHead({ title: 'Settings' })

const { isAdmin, capabilities, fetchCapabilities, ensureCapabilities, ensureSession }
  = useAuth()
// Resolve both explicitly rather than leaning on the global middleware's order,
// so `isAdmin` (from the session) is populated when adminOrOpenMode is computed.
onMounted(async () => {
  await Promise.all([ensureCapabilities(), ensureSession()])
})
const authEnabled = computed(() => capabilities.value?.authEnabled ?? true)
// Admin-only system actions (backup, the auth toggle) are shown to an admin, or
// to anyone while auth is off — an open board has no admin to gate them, and the
// API mirrors this (the gate bypasses in sem-auth mode).
const adminOrOpenMode = computed(() => !authEnabled.value || isAdmin.value)
const togglingAuth = ref(false)
async function toggleAuth(next: boolean) {
  togglingAuth.value = true
  try {
    await api('/admin/settings', {
      method: 'POST',
      body: { authEnabled: next }
    })
    window.location.reload()
  } finally {
    togglingAuth.value = false
  }
}

const keepDiffsOnArchive = computed(
  () => capabilities.value?.keepDiffsOnArchive ?? false
)
const togglingDiffs = ref(false)
async function toggleKeepDiffs(next: boolean) {
  togglingDiffs.value = true
  try {
    await api('/admin/settings', {
      method: 'POST',
      body: { keepDiffsOnArchive: next }
    })
    capabilities.value = await fetchCapabilities()
  } catch (e) {
    toast.add({
      title: 'Failed to update archiving setting',
      description: resolveError(e),
      color: 'error'
    })
  } finally {
    togglingDiffs.value = false
  }
}

function download(path: string) {
  const a = document.createElement('a')
  a.href = `${apiUrl}${path}`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const importing = ref(false)
const importError = ref<string | null>(null)
const imported = ref<Project[]>([])
const fileInput = ref<HTMLInputElement | null>(null)

async function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  importing.value = true
  importError.value = null
  imported.value = []
  try {
    const buf = await file.arrayBuffer()
    const { projectIds } = await api<{ projectIds: string[] }>('/import', {
      method: 'POST',
      body: buf,
      headers: { 'Content-Type': 'application/gzip' }
    })
    await store.loadProjects()
    const byId = new Map(store.projects.map(p => [p.id, p]))
    imported.value = projectIds.map(id => byId.get(id)).filter(Boolean) as Project[]
  } catch (err) {
    const data = (err as { data?: { error?: string } }).data
    importError.value = data?.error ?? (err as Error).message ?? 'Import failed'
  } finally {
    importing.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function openProject(slug: string) {
  store.setCurrent(slug)
  navigateTo('/board')
}
</script>

<template>
  <UDashboardPanel id="settings">
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UIcon name="i-lucide-settings" class="text-primary" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-2xl mx-auto w-full space-y-8">
        <div v-if="adminOrOpenMode">
          <UPageCard
            title="Backup"
            description="Export to a versioned .json.gz, or import one as a new project."
            variant="naked"
            class="mb-4"
          />
          <UPageCard
            variant="subtle"
            :ui="{ container: 'gap-4', wrapper: 'mb-0' }"
          >
            <div class="space-y-4">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium">
                    Export project
                  </p>
                  <p class="mt-0.5 text-xs text-muted">
                    Export {{ currentProject ? currentProject.name : "the selected project" }} to a versioned .json.gz.
                  </p>
                </div>
                <UButton
                  icon="i-lucide-download"
                  label="Export project"
                  color="neutral"
                  variant="subtle"
                  class="min-w-[160px] justify-center shrink-0"
                  :disabled="!currentProject"
                  @click="download(`/projects/${currentProject!.id}/export`)"
                />
              </div>

              <USeparator />

              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium">
                    Export all
                  </p>
                  <p class="mt-0.5 text-xs text-muted">
                    Every project in one .json.gz file.
                  </p>
                </div>
                <UButton
                  icon="i-lucide-download"
                  label="Export all"
                  color="neutral"
                  variant="subtle"
                  class="min-w-[160px] justify-center shrink-0"
                  @click="download('/export')"
                />
              </div>

              <USeparator />

              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium">
                    Import
                  </p>
                  <p class="mt-0.5 text-xs text-muted">
                    Restores as a new project (keys preserved; a name clash is suffixed).
                  </p>
                </div>
                <UButton
                  icon="i-lucide-upload"
                  label="Import…"
                  color="neutral"
                  variant="subtle"
                  class="min-w-[160px] justify-center shrink-0"
                  :loading="importing"
                  @click="fileInput?.click()"
                />
                <input
                  ref="fileInput"
                  type="file"
                  accept=".gz,application/gzip"
                  aria-label="Import a backup file"
                  class="hidden"
                  @change="onImportFile"
                >
              </div>

              <template v-if="imported.length">
                <USeparator />
                <div class="space-y-1.5">
                  <div class="flex items-center gap-2 text-sm text-success">
                    <UIcon name="i-lucide-check-circle" />
                    <span>Imported {{ imported.length }} project{{ imported.length === 1 ? "" : "s" }} as new.</span>
                  </div>
                  <div
                    v-for="p in imported"
                    :key="p.id"
                    class="flex items-center gap-2 text-sm pl-6"
                  >
                    <span class="flex-1 truncate text-muted">{{ p.name }} ({{ p.slug }})</span>
                    <UButton
                      size="xs"
                      color="primary"
                      variant="subtle"
                      label="Open"
                      @click="openProject(p.slug)"
                    />
                  </div>
                </div>
              </template>

              <template v-if="importError">
                <USeparator />
                <div class="flex items-center gap-2 text-sm text-error">
                  <UIcon name="i-lucide-alert-triangle" />
                  <span>{{ importError }}</span>
                </div>
              </template>
            </div>
          </UPageCard>
        </div>

        <div v-if="adminOrOpenMode">
          <UPageCard
            title="Authentication"
            description="Control who can access the board."
            variant="naked"
            class="mb-4"
          />
          <UPageCard
            variant="subtle"
            :ui="{ container: 'gap-4', wrapper: 'mb-0' }"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">
                  Require login
                </p>
                <p class="mt-0.5 text-xs text-muted">
                  On: login required, the admin approves new users. Off: open mode — anyone with network access uses the board without logging in.
                </p>
              </div>
              <USwitch
                :model-value="authEnabled"
                :loading="togglingAuth"
                class="shrink-0"
                @update:model-value="toggleAuth"
              />
            </div>
          </UPageCard>
        </div>

        <div v-if="adminOrOpenMode">
          <UPageCard
            title="Archiving"
            description="What happens to attached diffs when a card or sprint is archived."
            variant="naked"
            class="mb-4"
          />
          <UPageCard
            variant="subtle"
            :ui="{ container: 'gap-4', wrapper: 'mb-0' }"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">
                  Keep diffs on archive
                </p>
                <p class="mt-0.5 text-xs text-muted">
                  On: attached diffs are kept when archiving a card or sprint. Off (default): diffs are dropped; re-run attach-commit to restore one.
                </p>
              </div>
              <USwitch
                :model-value="keepDiffsOnArchive"
                :loading="togglingDiffs"
                class="shrink-0"
                @update:model-value="toggleKeepDiffs"
              />
            </div>
          </UPageCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
