<script setup lang="ts">
import type { Project } from '@claude-organizer/shared'

import { useProjectStore } from '~/stores/project'

const store = useProjectStore()
const { currentProject } = storeToRefs(store)
const api = useApi()
const apiUrl = (useRuntimeConfig().public.apiUrl as string).replace(/\/$/, '')

useHead({ title: 'Settings' })

const { isAdmin, capabilities, ensureCapabilities, ensureSession } = useAuth()
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
async function toggleAuth() {
  togglingAuth.value = true
  try {
    await api('/admin/settings', {
      method: 'POST',
      body: { authEnabled: !authEnabled.value }
    })
    window.location.reload()
  } finally {
    togglingAuth.value = false
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
          <UIcon name="i-lucide-settings" class="text-primary" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-2xl mx-auto w-full space-y-8">
        <UPageCard
          v-if="adminOrOpenMode"
          title="Backup"
          description="Export a project (or everything) to a versioned .json.gz, or import one as a brand-new project."
          variant="subtle"
          :ui="{ container: 'gap-4', wrapper: 'mb-0' }"
        >
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">
                  Export this project
                </p>
                <p class="text-xs text-muted truncate">
                  {{ currentProject ? currentProject.name : "No project selected" }}
                </p>
              </div>
              <UButton
                icon="i-lucide-download"
                label="Export project"
                color="neutral"
                variant="subtle"
                :disabled="!currentProject"
                @click="download(`/projects/${currentProject!.id}/export`)"
              />
            </div>

            <div class="flex items-center justify-between gap-3 border-t border-default pt-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">
                  Export everything
                </p>
                <p class="text-xs text-muted">
                  All projects in one file.
                </p>
              </div>
              <UButton
                icon="i-lucide-download"
                label="Export all"
                color="neutral"
                variant="subtle"
                @click="download('/export')"
              />
            </div>

            <div class="flex items-center justify-between gap-3 border-t border-default pt-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">
                  Import a backup
                </p>
                <p class="text-xs text-muted">
                  Restores as a new project (keys preserved; a name clash is suffixed).
                </p>
              </div>
              <UButton
                icon="i-lucide-upload"
                label="Import…"
                color="neutral"
                variant="subtle"
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

            <div
              v-if="imported.length"
              class="border-t border-default pt-3 space-y-1.5"
            >
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
            <div
              v-if="importError"
              class="flex items-center gap-2 text-sm text-error border-t border-default pt-3"
            >
              <UIcon name="i-lucide-alert-triangle" />
              <span>{{ importError }}</span>
            </div>
          </div>
        </UPageCard>

        <UPageCard
          v-if="adminOrOpenMode"
          title="Authentication"
          description="With auth disabled the board runs without login (open mode): anyone with network access uses it. Enable it to require login and grant users access by role/project."
          variant="subtle"
          :ui="{ container: 'gap-4', wrapper: 'mb-0' }"
        >
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">
                  {{ authEnabled ? "Enabled" : "Disabled (open mode)" }}
                </p>
                <p class="text-xs text-muted">
                  {{ authEnabled
                    ? "Login required; the admin approves new users."
                    : "Anyone with network access uses the board without logging in." }}
                </p>
              </div>
              <UButton
                :color="authEnabled ? 'error' : 'primary'"
                variant="subtle"
                :loading="togglingAuth"
                :label="authEnabled ? 'Disable' : 'Enable'"
                @click="toggleAuth"
              />
            </div>
          </div>
        </UPageCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
