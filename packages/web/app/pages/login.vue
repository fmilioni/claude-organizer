<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

import type { AuthCapabilities } from '@claude-organizer/shared'

definePageMeta({ layout: false })

const {
  fetchCapabilities,
  fetchSession,
  signUpEmail,
  signInEmail,
  signInGithub
} = useAuth()
const api = useApi()
const route = useRoute()
const config = useRuntimeConfig()

const caps = ref<AuthCapabilities | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const state = reactive({ name: '', email: '', password: '' })

// When the MCP OAuth authorize endpoint has no session it redirects here (its
// loginPage) with the original authorize query appended. After login we must
// re-hit authorize as a top-level navigation so, now authenticated, it issues
// the code and redirects back to the MCP client — an AJAX sign-in alone would
// leave the browser on the login page and strand the flow.
const oauthResumeUrl = computed(() => {
  const q = route.query
  if (!q.client_id || !q.redirect_uri || !q.response_type) return null
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    if (typeof v === 'string') params.set(k, v)
  }
  return `${config.public.apiUrl}/api/auth/mcp/authorize?${params.toString()}`
})

function afterLogin() {
  if (oauthResumeUrl.value) {
    window.location.href = oauthResumeUrl.value
    return
  }
  return navigateTo('/')
}

// No user yet → first boot: this first sign-up claims the admin.
const setupMode = computed(() => caps.value !== null && !caps.value.hasUsers)
const githubEnabled = computed(() => caps.value?.github ?? false)

const mode = ref<'signin' | 'signup'>('signin')
// setupMode forces signup (the first-boot admin claim); outside it the toggle
// decides. Hidden during an MCP OAuth resume: a fresh signup lands pending and
// can't complete authorize, so we don't expose it there.
const isSignup = computed(() => setupMode.value || mode.value === 'signup')
const canSignUp = computed(
  () => (caps.value?.emailPassword ?? false) && !oauthResumeUrl.value
)

function toggleMode() {
  mode.value = mode.value === 'signin' ? 'signup' : 'signin'
  error.value = null
}

const heading = computed(() =>
  setupMode.value
    ? 'Create administrator'
    : isSignup.value
      ? 'Create account'
      : 'Sign in'
)
const subtitle = computed(() =>
  setupMode.value
    ? 'First run: create the board administrator account.'
    : isSignup.value
      ? 'Create your account. An administrator must approve access.'
      : 'Sign in to Claude Organizer.'
)
const submitLabel = computed(() =>
  setupMode.value
    ? 'Create and sign in'
    : isSignup.value
      ? 'Create account'
      : 'Sign in'
)
useHead({ title: () => heading.value })

onMounted(async () => {
  try {
    caps.value = await fetchCapabilities()
  } catch {
    // Unreachable capabilities: fall back to the login form.
  }
})

function validate(s: typeof state): FormError[] {
  const errors: FormError[] = []
  if (!s.email) {
    errors.push({ name: 'email', message: 'Enter your email' })
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) {
    errors.push({ name: 'email', message: 'Invalid email' })
  }
  if (!s.password || s.password.length < 8) {
    errors.push({ name: 'password', message: 'At least 8 characters' })
  }
  if (isSignup.value && !s.name) {
    errors.push({ name: 'name', message: 'Enter your name' })
  }
  return errors
}

async function onSubmit(_event: FormSubmitEvent<typeof state>) {
  loading.value = true
  error.value = null
  try {
    if (isSignup.value) {
      await signUpEmail({
        name: state.name,
        email: state.email,
        password: state.password
      })
    } else {
      await signInEmail({ email: state.email, password: state.password })
    }
    await afterLogin()
  } catch (e) {
    // The MCP OAuth after-hook can turn the sign-in response into a redirect to
    // the client, making the AJAX call throw even though the session was set.
    // If we're resuming OAuth and the session really exists, proceed anyway.
    if (oauthResumeUrl.value && (await fetchSession().catch(() => null))) {
      window.location.href = oauthResumeUrl.value
      return
    }
    error.value = resolveError(e)
  } finally {
    loading.value = false
  }
}

// Setup-only system preference; persisted before any admin exists via the
// hasAnyUser-guarded /setup/settings (mirrors /admin/settings once set up).
const keepDiffsOnArchive = computed(() => caps.value?.keepDiffsOnArchive ?? false)
const togglingDiffs = ref(false)
async function onToggleKeepDiffs(next: boolean) {
  togglingDiffs.value = true
  try {
    await api('/setup/settings', {
      method: 'POST',
      body: { keepDiffsOnArchive: next }
    })
    if (caps.value) caps.value.keepDiffsOnArchive = next
  } catch (e) {
    error.value = resolveError(e)
  } finally {
    togglingDiffs.value = false
  }
}

// Setup-only "run without login" choice. A full reload re-resolves capabilities
// and the auth middleware, which then sees sem-auth and stops gating.
async function onDisableAuth() {
  loading.value = true
  error.value = null
  try {
    await api('/setup/disable-auth', { method: 'POST' })
    window.location.href = '/'
  } catch (e) {
    error.value = resolveError(e)
    loading.value = false
  }
}

async function onGithub() {
  loading.value = true
  error.value = null
  try {
    // In an OAuth flow, come back to authorize (not the app) so it resumes.
    await signInGithub(oauthResumeUrl.value ?? undefined)
  } catch (e) {
    error.value = resolveError(e)
    loading.value = false
  }
}

function resolveError(e: unknown): string {
  // better-auth errors carry `message`; the project's Fastify handler uses `error`.
  const data = (e as { data?: { message?: string, error?: string } })?.data
  return (
    data?.message ?? data?.error ?? (e as Error)?.message ?? 'Authentication failed'
  )
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-lg font-semibold">
          {{ heading }}
        </h1>
        <p class="text-sm text-muted">
          {{ subtitle }}
        </p>
      </template>

      <UForm
        :state="state"
        :validate="validate"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField v-if="isSignup" name="name" label="Name">
          <UInput v-model="state.name" autocomplete="name" />
        </UFormField>

        <UFormField name="email" label="Email">
          <UInput v-model="state.email" type="email" autocomplete="email" />
        </UFormField>

        <UFormField name="password" label="Password">
          <UInput
            v-model="state.password"
            type="password"
            :autocomplete="isSignup ? 'new-password' : 'current-password'"
          />
        </UFormField>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          :title="error"
        />

        <UButton type="submit" block :loading="loading">
          {{ submitLabel }}
        </UButton>

        <p v-if="!setupMode && canSignUp" class="text-center text-sm text-muted">
          {{ isSignup ? 'Already have an account?' : "Don't have an account?" }}
          <UButton variant="link" class="p-0" @click="toggleMode">
            {{ isSignup ? 'Sign in' : 'Create account' }}
          </UButton>
        </p>
      </UForm>

      <div v-if="setupMode" class="mt-4 pt-4 border-t border-default space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium">
              Keep diffs on archive
            </p>
            <p class="text-xs text-muted">
              By default, archiving a card/sprint discards the attached diffs
              (the commit metadata stays). Enable this to keep them.
            </p>
          </div>
          <USwitch
            :model-value="keepDiffsOnArchive"
            :loading="togglingDiffs"
            @update:model-value="onToggleKeepDiffs"
          />
        </div>

        <div class="pt-4 border-t border-default">
          <p class="text-xs text-muted mb-2">
            Or run without authentication: anyone with network access uses the
            board without logging in. You can re-enable it later in settings.
          </p>
          <UButton
            block
            color="neutral"
            variant="ghost"
            icon="i-lucide-unlock"
            :loading="loading"
            @click="onDisableAuth"
          >
            Disable authentication
          </UButton>
        </div>
      </div>

      <template v-if="githubEnabled" #footer>
        <UButton
          block
          color="neutral"
          variant="subtle"
          icon="i-lucide-github"
          :loading="loading"
          @click="onGithub"
        >
          Sign in with GitHub
        </UButton>
      </template>
    </UCard>
  </div>
</template>
