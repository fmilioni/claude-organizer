import type { CardClaim } from '~/types/card'

// Shared label for the advisory-claim hourglass indicators (tile tooltip, story
// envelope tooltip, card detail): "Reserved by <owner> · since <when>".
export function formatClaimHint(claim: CardClaim): string {
  const who = claim.ownerLabel ?? 'a session'
  return `Reserved by ${who} · since ${new Date(claim.claimedAt).toLocaleString()}`
}
