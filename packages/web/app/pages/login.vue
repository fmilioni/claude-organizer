<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

import type { AuthCapabilities } from '@claude-organizer/shared'

definePageMeta({ layout: false })
useHead({ title: 'Entrar' })

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
    errors.push({ name: 'email', message: 'Informe o e-mail' })
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) {
    errors.push({ name: 'email', message: 'E-mail inválido' })
  }
  if (!s.password || s.password.length < 8) {
    errors.push({ name: 'password', message: 'Mínimo de 8 caracteres' })
  }
  if (setupMode.value && !s.name) {
    errors.push({ name: 'name', message: 'Informe o nome' })
  }
  return errors
}

async function onSubmit(_event: FormSubmitEvent<typeof state>) {
  loading.value = true
  error.value = null
  try {
    if (setupMode.value) {
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
    data?.message ?? data?.error ?? (e as Error)?.message ?? 'Falha ao autenticar'
  )
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-lg font-semibold">
          {{ setupMode ? 'Criar administrador' : 'Entrar' }}
        </h1>
        <p class="text-sm text-muted">
          {{ setupMode
            ? 'Primeiro acesso: crie a conta de administrador do board.'
            : 'Acesse o Claude Organizer.' }}
        </p>
      </template>

      <UForm
        :state="state"
        :validate="validate"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField v-if="setupMode" name="name" label="Nome">
          <UInput v-model="state.name" autocomplete="name" />
        </UFormField>

        <UFormField name="email" label="E-mail">
          <UInput v-model="state.email" type="email" autocomplete="email" />
        </UFormField>

        <UFormField name="password" label="Senha">
          <UInput
            v-model="state.password"
            type="password"
            :autocomplete="setupMode ? 'new-password' : 'current-password'"
          />
        </UFormField>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          :title="error"
        />

        <UButton type="submit" block :loading="loading">
          {{ setupMode ? 'Criar e entrar' : 'Entrar' }}
        </UButton>
      </UForm>

      <div v-if="setupMode" class="mt-4 pt-4 border-t border-default">
        <p class="text-xs text-muted mb-2">
          Ou rode sem autenticação: qualquer pessoa com acesso à rede usa o
          board sem login. Dá para reativar depois nas configurações.
        </p>
        <UButton
          block
          color="neutral"
          variant="ghost"
          icon="i-lucide-unlock"
          :loading="loading"
          @click="onDisableAuth"
        >
          Desabilitar autenticação
        </UButton>
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
          Entrar com GitHub
        </UButton>
      </template>
    </UCard>
  </div>
</template>
