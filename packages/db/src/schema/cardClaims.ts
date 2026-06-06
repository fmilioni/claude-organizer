import { relations, sql } from 'drizzle-orm'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { cards } from './cards'

// Advisory reservation of a card by an agent session (CO-199). One row per card
// (PK = card_id). `ownerToken` is the opaque per-run secret the skill holds: it
// authorizes release/take-over and is NEVER returned on reads — only the label
// and timestamp are surfaced. The claim is a dimension separate from the card
// status — a not-yet-started card can be reserved without changing its status.
export const cardClaims = pgTable('card_claims', {
  cardId: text('card_id')
    .primaryKey()
    .references(() => cards.id, { onDelete: 'cascade' }),
  ownerToken: text('owner_token').notNull(),
  ownerLabel: text('owner_label'),
  claimedAt: timestamp('claimed_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
})

export const cardClaimsRelations = relations(cardClaims, ({ one }) => ({
  card: one(cards, { fields: [cardClaims.cardId], references: [cards.id] })
}))
