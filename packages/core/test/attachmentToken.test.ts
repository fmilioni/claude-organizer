import { describe, expect, it } from 'vitest'

import { signAttachmentToken, verifyAttachmentToken } from '../src/attachmentToken'
import { signCommitToken } from '../src/commitToken'

const SECRET = 'test-secret'

describe('attachmentToken', () => {
  it('verifies a fresh token for its own attachment', () => {
    const { token } = signAttachmentToken('att_1', SECRET)
    expect(verifyAttachmentToken(token, 'att_1', SECRET)).toBe(true)
  })

  it('rejects a token presented for a different attachment', () => {
    const { token } = signAttachmentToken('att_1', SECRET)
    expect(verifyAttachmentToken(token, 'att_2', SECRET)).toBe(false)
  })

  it('rejects an expired token (default 60s TTL)', () => {
    const now = 1_000_000_000_000
    const { token } = signAttachmentToken('att_1', SECRET, 60, now)
    expect(verifyAttachmentToken(token, 'att_1', SECRET, now + 61_000)).toBe(false)
    expect(verifyAttachmentToken(token, 'att_1', SECRET, now + 59_000)).toBe(true)
  })

  it('rejects a token signed with a different secret', () => {
    const { token } = signAttachmentToken('att_1', SECRET)
    expect(verifyAttachmentToken(token, 'att_1', 'other-secret')).toBe(false)
  })

  it('does not accept a commit token as an attachment token (scope isolation)', () => {
    // A commit token whose card key happens to equal the attachment id must not
    // pass attachment verification — the scope tag separates the two purposes.
    const { token } = signCommitToken('att_1', SECRET)
    expect(verifyAttachmentToken(token, 'att_1', SECRET)).toBe(false)
  })

  it('exposes an ISO expiry consistent with the TTL', () => {
    const now = 1_000_000_000_000
    const { expiresAt } = signAttachmentToken('att_1', SECRET, 60, now)
    expect(new Date(expiresAt).getTime()).toBe(now + 60_000)
  })
})
