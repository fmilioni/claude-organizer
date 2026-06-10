<script setup lang="ts">
import type { EmbeddingRuntimeStatus } from '@claude-organizer/shared'
import { EMBEDDING_MODELS } from '@claude-organizer/shared'

const api = useApi()
const toast = useToast()

useHead({ title: 'Settings' })

const { isAdmin, capabilities, fetchCapabilities, ensureCapabilities, ensureSession }
  = useAuth()
// Resolve both explicitly rather than leaning on the global middleware's order,
// so `isAdmin` (from the session) is populated when adminOrOpenMode is computed.
onMounted(async () => {
  await Promise.all([ensureCapabilities(), ensureSession()])
  // The GET is admin-only — don't call it for a non-admin (would 403).
  if (adminOrOpenMode.value) await refreshEmbeddingStatus().catch(() => {})
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

const embedding = computed(() => capabilities.value?.embedding ?? null)
const embeddingModelItems = [
  ...Object.entries(EMBEDDING_MODELS).map(([id, info]) => ({
    label: `${id} (${info.dim}d)`,
    value: id
  })),
  { label: 'Disabled — lexical search only', value: 'none' }
]
// What the current effective config maps to in the select (a disabled deployment
// shows as 'none'); used to seed the picker and to detect a real change.
const currentModelChoice = computed(() =>
  embedding.value ? (embedding.value.enabled ? embedding.value.model : 'none') : null
)
const selectedModel = ref<string | undefined>(undefined)
watchEffect(() => {
  if (selectedModel.value === undefined && currentModelChoice.value !== null) {
    selectedModel.value = currentModelChoice.value
  }
})

const embeddingStatus = ref<EmbeddingRuntimeStatus | null>(null)
const applyingEmbedding = ref(false)
let statusTimer: ReturnType<typeof setTimeout> | null = null
// Guards the async poll chain: a reschedule/refetch resolving after the page
// unmounts must not run (onUnmounted already cleared the timer once).
let pollingMounted = true

const embeddingBusy = computed(
  () =>
    embeddingStatus.value?.state === 'reconciling'
    || embeddingStatus.value?.state === 'backfilling'
)
const pendingChange = computed(
  () =>
    selectedModel.value !== undefined
    && selectedModel.value !== currentModelChoice.value
)
const canApplyEmbedding = computed(
  () => pendingChange.value && !embeddingBusy.value
)

async function refreshEmbeddingStatus() {
  let status: EmbeddingRuntimeStatus
  try {
    status = await api<EmbeddingRuntimeStatus>('/admin/embedding')
  } catch {
    // Transient poll failure: keep the last frame and retry, instead of breaking
    // the chain and freezing the UI mid-backfill.
    if (pollingMounted && embeddingBusy.value) {
      statusTimer = setTimeout(refreshEmbeddingStatus, 1500)
    }
    return
  }
  if (!pollingMounted) return
  embeddingStatus.value = status
  if (embeddingBusy.value) {
    statusTimer = setTimeout(refreshEmbeddingStatus, 1500)
  } else {
    statusTimer = null
    capabilities.value = await fetchCapabilities()
  }
}

async function applyEmbedding() {
  if (selectedModel.value === undefined) return
  applyingEmbedding.value = true
  try {
    embeddingStatus.value = await api<EmbeddingRuntimeStatus>('/admin/embedding', {
      method: 'POST',
      body: { model: selectedModel.value }
    })
    if (embeddingBusy.value) {
      if (!statusTimer) statusTimer = setTimeout(refreshEmbeddingStatus, 1500)
    } else {
      capabilities.value = await fetchCapabilities()
    }
  } catch (e) {
    toast.add({
      title: 'Failed to apply embedding model',
      description: resolveError(e),
      color: 'error'
    })
  } finally {
    applyingEmbedding.value = false
  }
}

onUnmounted(() => {
  pollingMounted = false
  if (statusTimer) clearTimeout(statusTimer)
})
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

        <div v-if="adminOrOpenMode">
          <UPageCard
            title="Semantic search"
            description="Choose the embedding model used for semantic search, or turn it off."
            variant="naked"
            class="mb-4"
          />
          <UPageCard
            variant="subtle"
            :ui="{ container: 'gap-4', wrapper: 'mb-0' }"
          >
            <div class="space-y-4">
              <div>
                <p class="text-sm font-medium">
                  Embedding model
                </p>
                <p class="mt-0.5 text-xs text-muted">
                  <template v-if="embedding?.enabled">
                    Current: {{ embedding.model }} · {{ embedding.dim }}d.
                  </template>
                  <template v-else>
                    Semantic search is off — lexical search only.
                  </template>
                </p>
                <USelectMenu
                  v-model="selectedModel"
                  :items="embeddingModelItems"
                  value-key="value"
                  label-key="label"
                  :disabled="embeddingBusy"
                  class="mt-2 w-full"
                />
              </div>

              <UAlert
                v-if="pendingChange"
                color="warning"
                variant="soft"
                icon="i-lucide-alert-triangle"
                title="Changing the model can re-index embeddings"
                description="A model with a different dimension drops the existing vectors and rebuilds the index — search stays lexical-only until the backfill finishes. The MCP runs as a separate process; restart it (docker compose restart mcp) to use the new model there."
              />

              <div
                v-if="pendingChange || embeddingStatus"
                class="flex items-center justify-between gap-3"
              >
                <div class="min-w-0 text-xs">
                  <span
                    v-if="embeddingBusy"
                    class="inline-flex items-center gap-1.5 text-muted"
                  >
                    <UIcon name="i-lucide-loader-2" class="animate-spin" />
                    {{ embeddingStatus?.state === "reconciling" ? "Reconciling…" : "Backfilling…" }}
                    ({{ embeddingStatus?.backfill.docs }} docs · {{ embeddingStatus?.backfill.cards }} cards · {{ embeddingStatus?.backfill.comments }} comments)
                  </span>
                  <span
                    v-else-if="embeddingStatus?.state === 'done'"
                    class="inline-flex items-center gap-1.5 text-success"
                  >
                    <UIcon name="i-lucide-check-circle" />
                    Backfilled {{ embeddingStatus.backfill.docs }} docs · {{ embeddingStatus.backfill.cards }} cards · {{ embeddingStatus.backfill.comments }} comments.
                  </span>
                  <span
                    v-else-if="embeddingStatus?.state === 'error'"
                    class="inline-flex items-center gap-1.5 text-error"
                  >
                    <UIcon name="i-lucide-alert-triangle" />
                    {{ embeddingStatus.error }}
                  </span>
                </div>
                <UButton
                  v-if="pendingChange"
                  label="Apply"
                  color="primary"
                  variant="subtle"
                  class="min-w-[120px] justify-center shrink-0"
                  :loading="applyingEmbedding || embeddingBusy"
                  :disabled="!canApplyEmbedding"
                  @click="applyEmbedding"
                />
              </div>

              <div
                v-if="embeddingStatus?.mcpRestartRequired"
                class="flex items-center gap-2 text-xs text-warning"
              >
                <UIcon name="i-lucide-info" class="shrink-0" />
                <span>Restart the MCP to use the new model there: <code>docker compose restart mcp</code>.</span>
              </div>
            </div>
          </UPageCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
