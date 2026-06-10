import { signScopedToken, verifyScopedToken } from './signedToken'

// Attachment-scoped serve token: with auth on, `<img>` can't carry a session
// cookie cross-site, so the serve path accepts a short-lived signed value in the
// `?sig=` query instead. Pinned to one attachment id and a tight TTL.
export const ATTACHMENT_URL_TTL_SECONDS = 60

export function signAttachmentToken(
  attachmentId: string,
  secret: string,
  ttlSeconds: number = ATTACHMENT_URL_TTL_SECONDS,
  now?: number
): { token: string, expiresAt: string } {
  return signScopedToken('attachment', attachmentId, secret, ttlSeconds, now)
}

export function verifyAttachmentToken(
  token: string,
  expectedAttachmentId: string,
  secret: string,
  now?: number
): boolean {
  return verifyScopedToken('attachment', token, expectedAttachmentId, secret, now)
}
