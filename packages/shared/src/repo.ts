import type { RepoProvider } from './enums'

/**
 * Build the web URL of a commit on the project's repository, or `null` when the
 * project has no repo configured. GitHub puts the commit under `/commit/<sha>`;
 * GitLab under `/-/commit/<sha>`.
 */
export function buildCommitUrl(
  provider: RepoProvider | null | undefined,
  repoWebUrl: string | null | undefined,
  sha: string
): string | null {
  if (!provider || !repoWebUrl) return null
  const base = repoWebUrl.replace(/\/+$/, '')
  return provider === 'gitlab'
    ? `${base}/-/commit/${sha}`
    : `${base}/commit/${sha}`
}
