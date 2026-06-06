export function resolveError(e: unknown): string {
  const data = (e as { data?: { message?: string, error?: string } })?.data
  return data?.message ?? data?.error ?? (e as Error)?.message ?? 'Falha'
}
