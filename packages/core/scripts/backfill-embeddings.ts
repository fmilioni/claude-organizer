import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

import { createDb } from '@claude-organizer/db'

import {
  backfillCardEmbeddings,
  backfillCommentEmbeddings,
  backfillDocEmbeddings
} from '../src/index'

try {
  loadEnvFile(resolve(fileURLToPath(import.meta.url), '../../../../.env'))
} catch {
  // env file optional, falls back to process env
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required to backfill embeddings')
  process.exit(1)
}

const { db, close } = createDb({ url, max: 1 })

try {
  const docs = await backfillDocEmbeddings(db)
  const cards = await backfillCardEmbeddings(db)
  const comments = await backfillCommentEmbeddings(db)
  console.log(`Backfilled embeddings — docs: ${docs}, cards: ${cards}, comments: ${comments}`)
} catch (err) {
  console.error('Backfill failed:', err)
  process.exitCode = 1
} finally {
  await close()
}
