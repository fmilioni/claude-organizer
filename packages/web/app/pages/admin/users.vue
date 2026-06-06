<script setup lang="ts">
import type { PendingUser, UserRole } from '@claude-organizer/shared'

import { useProjectStore } from '~/stores/project'

definePageMeta({ middleware: 'admin' })
useHead({ title: 'Usuários' })

const api = useApi()
const toast = useToast()
const store = useProjectStore()
const { projects } = storeToRefs(store)

const pending = ref<PendingUser[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    pending.value = await api<PendingUser[]>('/admin/users/pending')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const roleItems = [
  { label: 'Usuário', value: 'user' as UserRole },
  { label: 'Administrador', value: 'admin' as UserRole }
]
const scopeItems = [
  { label: 'Todos os projetos (inclui futuros)', value: 'all' },
  { label: 'Selecionar projetos', value: 'subset' }
]

const approving = ref<PendingUser | null>(null)
const role = ref<UserRole>('user')
const scope = ref<'all' | 'subset'>('all')
const selectedProjects = ref<string[]>([])
const saving = ref(false)
const error = ref<string | null>(null)

// Map to {id,name} so USelectMenu doesn't pick up Project.description (nullable,
// which its item type rejects) as the item description.
const projectItems = computed(() =>
  projects.value.map(p => ({ id: p.id, name: p.name }))
)

const showProjectPicker = computed(
  () => role.value === 'user' && scope.value === 'subset'
)

function openApprove(u: PendingUser) {
  approving.value = u
  role.value = 'user'
  scope.value = 'all'
  selectedProjects.value = []
  error.value = null
}

async function confirmApprove() {
  if (!approving.value) return
  saving.value = true
  error.value = null
  try {
    const allProjects = role.value === 'admin' || scope.value === 'all'
    await api(`/admin/users/${approving.value.id}/approve`, {
      method: 'POST',
      body: {
        role: role.value,
        allProjects,
        projectIds: allProjects ? [] : selectedProjects.value
      }
    })
    approving.value = null
    await load()
  } catch (e) {
    error.value = resolveError(e)
  } finally {
    saving.value = false
  }
}

const rejecting = ref<string | null>(null)
async function reject(u: PendingUser) {
  rejecting.value = u.id
  try {
    await api(`/admin/users/${u.id}/reject`, { method: 'POST' })
    await load()
  } catch (e) {
    toast.add({
      title: 'Falha ao rejeitar',
      description: resolveError(e),
      color: 'error'
    })
  } finally {
    rejecting.value = null
  }
}
</script>

<template>
  <UDashboardPanel id="admin-users">
    <template #header>
      <UDashboardNavbar title="Usuários">
        <template #leading>
          <UIcon name="i-lucide-users" class="text-primary" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-2xl mx-auto w-full space-y-4">
        <p class="text-sm text-muted">
          Usuários que entraram e aguardam liberação. Aprove definindo papel e
          projetos, ou rejeite para remover da fila.
        </p>

        <div
          v-if="!loading && pending.length === 0"
          class="text-sm text-muted border border-default rounded-lg p-8 text-center"
        >
          Nenhum usuário pendente.
        </div>

        <ul v-else class="space-y-2">
          <li
            v-for="u in pending"
            :key="u.id"
            class="flex items-center gap-3 border border-default rounded-lg p-3"
          >
            <UAvatar :src="u.image ?? undefined" :alt="u.name" size="md" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate">
                {{ u.name }}
              </p>
              <p class="text-xs text-muted truncate">
                {{ u.email }}
              </p>
            </div>
            <UButton
              size="sm"
              color="primary"
              variant="subtle"
              label="Aprovar"
              @click="openApprove(u)"
            />
            <UButton
              size="sm"
              color="error"
              variant="ghost"
              label="Rejeitar"
              :loading="rejecting === u.id"
              @click="reject(u)"
            />
          </li>
        </ul>
      </div>
    </template>

    <UModal
      :open="approving !== null"
      title="Aprovar usuário"
      :description="approving?.email"
      @update:open="(o: boolean) => { if (!o) approving = null }"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Papel">
            <USelectMenu
              v-model="role"
              :items="roleItems"
              value-key="value"
              label-key="label"
            />
          </UFormField>

          <UFormField v-if="role === 'user'" label="Acesso a projetos">
            <USelectMenu
              v-model="scope"
              :items="scopeItems"
              value-key="value"
              label-key="label"
            />
          </UFormField>

          <UFormField v-if="showProjectPicker" label="Projetos">
            <USelectMenu
              v-model="selectedProjects"
              :items="projectItems"
              multiple
              value-key="id"
              label-key="name"
              placeholder="Selecione os projetos"
            />
          </UFormField>

          <UAlert
            v-if="error"
            color="error"
            variant="soft"
            :title="error"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" label="Cancelar" @click="approving = null" />
          <UButton
            color="primary"
            label="Aprovar"
            :loading="saving"
            :disabled="showProjectPicker && selectedProjects.length === 0"
            @click="confirmApprove"
          />
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
