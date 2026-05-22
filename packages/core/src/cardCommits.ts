import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { createId, type Database, schema } from '@claude-organizer/db'

import { InputError } from './errors'
import { notify } from './events'

// Server-side safeguards. The capture script already prunes lockfiles/binaries
// and truncates huge files, but cap the payload here too so a misbehaving
// client can't store an unbounded blob.
const MAX_DIFF_CHARS = 1_000_000
const MAX_STAT_CHARS = 100_000

export const attachCardCommitInput = z.object({
  // The script knows the card key (parsed from the commit message), not the id.
  cardKey: z.string().min(1),
  sha: z.string().min(1),
  message: z.string().min(1),
  stat: z.string().max(MAX_STAT_CHARS).nullish(),
  diff: z.string().max(MAX_DIFF_CHARS).nullish(),
  // ISO string on the wire (git's `%cI`); stored as a timestamptz `Date`.
  committedAt: z
    .string()
    .nullish()
    .transform(v => (v ? new Date(v) : null)),
  authorName: z.string().nullish()
})
// The function takes the wire input (committedAt as string); `.parse()` yields
// the output shape (committedAt as Date).
export type AttachCardCommitInput = z.input<typeof attachCardCommitInput>

/**
 * Attach (or re-attach) a commit to the card whose key matches `cardKey`.
 * Upserts on `(cardId, sha)` so re-running for the same commit — e.g. after an
 * `amend` — updates the stored diff instead of duplicating it.
 */
export async function attachCardCommit(
  db: Database,
  input: AttachCardCommitInput
) {
  const parsed = attachCardCommitInput.parse(input)
  const [card] = await db
    .select({ id: schema.cards.id, projectId: schema.cards.projectId })
    .from(schema.cards)
    .where(eq(schema.cards.key, parsed.cardKey))
    .limit(1)
  if (!card) {
    throw new InputError(`Card ${parsed.cardKey} not found`)
  }
  const values = {
    message: parsed.message,
    stat: parsed.stat ?? null,
    diff: parsed.diff ?? null,
    committedAt: parsed.committedAt ?? null,
    authorName: parsed.authorName ?? null
  }
  const [row] = await db
    .insert(schema.cardCommits)
    .values({
      id: createId('ccm'),
      cardId: card.id,
      sha: parsed.sha,
      ...values
    })
    .onConflictDoUpdate({
      target: [schema.cardCommits.cardId, schema.cardCommits.sha],
      set: values
    })
    .returning()
  if (row) {
    await notify(db, {
      type: 'commit.changed',
      projectId: card.projectId,
      cardId: card.id,
      commitId: row.id
    })
  }
  return row
}

export async function listCardCommits(db: Database, cardId: string) {
  return db
    .select()
    .from(schema.cardCommits)
    .where(eq(schema.cardCommits.cardId, cardId))
    .orderBy(
      desc(schema.cardCommits.committedAt),
      desc(schema.cardCommits.createdAt)
    )
}

/**
 * Fetch a single attached commit by sha — with its (possibly null) diff. When
 * the same sha is attached to several cards, `cardId` narrows it; otherwise the
 * first match is returned (the diff is identical across cards).
 */
export async function getCommitBySha(
  db: Database,
  sha: string,
  cardId?: string
) {
  const [row] = await db
    .select()
    .from(schema.cardCommits)
    .where(
      cardId
        ? and(
            eq(schema.cardCommits.sha, sha),
            eq(schema.cardCommits.cardId, cardId)
          )
        : eq(schema.cardCommits.sha, sha)
    )
    .limit(1)
  return row ?? null
}
