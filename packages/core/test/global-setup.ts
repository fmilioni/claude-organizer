import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { createDb, runMigrations } from '@claude-organizer/db'

let container: StartedPostgreSqlContainer

// Spins one ephemeral Postgres for the whole suite, applies the real
// migrations, and hands the connection URL to the tests via `provide`/`inject`.
export default async function setup({
  provide
}: {
  provide: (key: 'databaseUrl', value: string) => void
}) {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  const url = container.getConnectionUri()

  const { db, close } = createDb({ url, max: 1 })
  try {
    await runMigrations(db)
  } finally {
    await close()
  }

  provide('databaseUrl', url)

  return async () => {
    await container.stop()
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string
  }
}
