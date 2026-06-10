const PUBLIC_PATHS = ['/login', '/no-access']

export default defineNuxtRouteMiddleware(async (to) => {
  const { user, ensureSession, ensureCapabilities } = useAuth()
  const caps = await ensureCapabilities()

  // Sem-auth mode: no sessions, no gating — the board runs as it did pre-auth.
  // Public-only routes (login / no-access) have no purpose without auth → home.
  if (!caps.authEnabled) {
    return PUBLIC_PATHS.includes(to.path) ? navigateTo('/') : undefined
  }

  await ensureSession()

  if (!user.value) {
    return PUBLIC_PATHS.includes(to.path) ? undefined : navigateTo('/login')
  }

  // Authenticated but not yet approved by an admin → the "no access" page.
  if (user.value.status !== 'approved') {
    return to.path === '/no-access' ? undefined : navigateTo('/no-access')
  }

  if (PUBLIC_PATHS.includes(to.path)) return navigateTo('/')
})
