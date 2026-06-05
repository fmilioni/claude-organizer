import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core'

import { users } from './auth'

// OAuth 2.1 authorization-server tables for the better-auth `mcp`/`oidc-provider`
// plugin (clients, issued tokens, consents). Field names are the camelCase JS
// keys the better-auth drizzle adapter maps onto; with `usePlural` the model
// `oauthApplication` resolves to the `oauthApplications` key. Like the other
// better-auth tables they are NOT under conformance.ts — better-auth owns the
// shape. See ADR "Auth do MCP via OAuth 2.1 (plugin mcp do better-auth)".

export const oauthApplications = pgTable(
  'oauth_applications',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    icon: text('icon'),
    metadata: text('metadata'),
    // Column-level UNIQUE constraint (not just an index): oauthAccessTokens /
    // oauthConsents reference clientId by FK, and Postgres needs a unique
    // constraint — a `CREATE UNIQUE INDEX` is not a valid FK target.
    clientId: text('client_id')
      .notNull()
      .unique('oauth_applications_client_id_uk'),
    clientSecret: text('client_secret'),
    redirectUrls: text('redirect_urls').notNull(),
    type: text('type').notNull(),
    disabled: boolean('disabled').notNull().default(false),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
  },
  t => [index('oauth_applications_user_idx').on(t.userId)]
)

export const oauthAccessTokens = pgTable(
  'oauth_access_tokens',
  {
    id: text('id').primaryKey(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true
    }).notNull(),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true
    }).notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthApplications.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    scopes: text('scopes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
  },
  t => [
    uniqueIndex('oauth_access_tokens_access_token_uk').on(t.accessToken),
    uniqueIndex('oauth_access_tokens_refresh_token_uk').on(t.refreshToken),
    index('oauth_access_tokens_client_idx').on(t.clientId),
    index('oauth_access_tokens_user_idx').on(t.userId)
  ]
)

export const oauthConsents = pgTable(
  'oauth_consents',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthApplications.clientId, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scopes: text('scopes').notNull(),
    consentGiven: boolean('consent_given').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
  },
  t => [
    index('oauth_consents_client_idx').on(t.clientId),
    index('oauth_consents_user_idx').on(t.userId)
  ]
)
