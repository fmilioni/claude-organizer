import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, inject } from 'vitest'

import { createDb, type Database } from '@claude-organizer/db'

import { createProject } from '../src/index'

export interface TestDb {
  db: Database
}

/**
 * Opens a connection to the suite's ephemeral Postgres for the current test
 * file and closes it afterwards. Call at the top level of a test file.
 */
export function useTestDb(): TestDb {
  const ctx: TestDb = {} as TestDb
  let close: () => Promise<void>

  beforeAll(() => {
    const conn = createDb({ url: inject('databaseUrl') })
    ctx.db = conn.db
    close = conn.close
  })

  afterAll(async () => {
    await close()
  })

  return ctx
}

/**
 * Create an isolated project so each test operates in its own namespace.
 * The slug uses a random UUID so it stays unique even when test files run in
 * parallel workers (Vitest's default).
 */
export function freshProject(db: Database, keyPrefix = 'CO') {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  return createProject(db, {
    name: `Test Project ${suffix}`,
    slug: `test-${suffix}`,
    keyPrefix
  })
}

/**
 * A globally-unique key prefix. Card keys are unique only per project
 * (`cards_project_key_uk`), so a key like `CO-1` repeats across the many
 * default-prefix projects parallel test files create. Tests that resolve a card
 * BY KEY (`attachCardCommit`, `getCardByKey`) must use this, or the lookup may
 * hit another file's same-key card and flake.
 */
export function uniqueKeyPrefix() {
  return `T${randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`
}
