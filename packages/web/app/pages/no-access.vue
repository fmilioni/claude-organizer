<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: 'No access' })

const { user, signOut } = useAuth()
const loading = ref(false)

async function onSignOut() {
  loading.value = true
  try {
    await signOut()
    await navigateTo('/login')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-sm text-center">
      <template #header>
        <UIcon name="i-lucide-lock" class="size-8 text-muted mx-auto" />
        <h1 class="text-lg font-semibold mt-2">
          Awaiting approval
        </h1>
      </template>

      <p class="text-sm text-muted">
        Your account<span v-if="user"> (<strong>{{ user.email }}</strong>)</span>
        doesn't have access to the board yet. Ask an administrator to approve it.
      </p>

      <template #footer>
        <UButton
          block
          color="neutral"
          variant="subtle"
          icon="i-lucide-log-out"
          :loading="loading"
          @click="onSignOut"
        >
          Sign out
        </UButton>
      </template>
    </UCard>
  </div>
</template>
