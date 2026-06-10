<script setup lang="ts">
import { useProjectStore } from '~/stores/project'

const props = defineProps<{ collapsed?: boolean }>()

const store = useProjectStore()
const { projects, currentProject } = storeToRefs(store)

const showCreate = ref(false)

// Two groups → UDropdownMenu renders a separator between them: the project list,
// then the actions (add a project, manage projects) — like the template switcher.
const items = computed(() => [
  projects.value.map(p => ({
    label: p.name,
    description: p.slug,
    icon: 'i-lucide-folder',
    onSelect: () => store.setCurrent(p.slug),
    active: p.slug === currentProject.value?.slug
  })),
  [
    {
      label: 'Add project',
      icon: 'i-lucide-circle-plus',
      onSelect: () => {
        showCreate.value = true
      }
    },
    {
      label: 'Manage projects',
      icon: 'i-lucide-folders',
      to: '/projects'
    }
  ]
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :modal="false"
    :ui="{ content: props.collapsed ? 'w-56' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      :square="collapsed"
      :trailing-icon="collapsed ? undefined : 'i-lucide-chevron-down'"
      :class="collapsed ? undefined : 'w-full justify-between'"
    >
      <template #default>
        <UIcon v-if="collapsed" name="i-lucide-folder" class="text-primary" />
        <span v-else-if="currentProject" class="flex min-w-0 items-center gap-2">
          <UIcon name="i-lucide-folder" class="text-primary" />
          <span class="truncate font-medium">{{ currentProject.name }}</span>
        </span>
        <span v-else class="text-muted text-sm">No project</span>
      </template>
    </UButton>
  </UDropdownMenu>

  <AppCreateProjectModal v-model:open="showCreate" />
</template>
