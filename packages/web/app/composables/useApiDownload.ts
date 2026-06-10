// Trigger a browser download from an API-relative path. Mirrors useApi's baseURL
// (the file streams from the API origin, a distinct cross-site origin), so callers
// pass just the path.
export function useApiDownload() {
  const baseURL = (useRuntimeConfig().public.apiUrl as string).replace(/\/$/, '')
  return (path: string) => {
    const a = document.createElement('a')
    a.href = `${baseURL}${path}`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
}
