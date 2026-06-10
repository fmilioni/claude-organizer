// Page guard for screens open to admins, plus everyone in open (sem-auth) mode.
// Unlike `admin` (which sends open mode home), open mode has no admin to gate, so
// it passes. Runs after the global auth middleware — session + capabilities are
// already resolved.
export default defineNuxtRouteMiddleware(() => {
  const { user, capabilities } = useAuth()
  if (capabilities.value && !capabilities.value.authEnabled) return
  if (user.value?.role !== 'admin') return navigateTo('/')
})
