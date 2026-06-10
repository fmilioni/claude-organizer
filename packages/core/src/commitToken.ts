import { signScopedToken, verifyScopedToken } from './signedToken'

// Card-scoped diff-write token (attach-commit / attach-worktree-diff): a thin
// scope binding over the generic signed token. The MCP signs it from an
// authorized OAuth session; the API verifies it on the two diff-write routes.
export { resolveCommitTokenSecret } from './signedToken'

export function signCommitToken(
  cardKey: string,
  secret: string,
  ttlSeconds?: number,
  now?: number
): { token: string, expiresAt: string } {
  return signScopedToken('commit', cardKey, secret, ttlSeconds, now)
}

export function verifyCommitToken(
  token: string,
  expectedCardKey: string,
  secret: string,
  now?: number
): boolean {
  return verifyScopedToken('commit', token, expectedCardKey, secret, now)
}
