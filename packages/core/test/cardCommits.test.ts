import { describe, expect, it } from 'vitest'

import { WORKING_TREE_SHA } from '@claude-organizer/shared'

import { attachCardCommit, createCard, listCardCommits } from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()

describe('listCardCommits ordering', () => {
  it('floats the working-tree sentinel (null committedAt) above real commits', async () => {
    const project = await freshProject(ctx.db)
    const card = await createCard(ctx.db, {
      projectId: project.id,
      title: 'Card'
    })

    await attachCardCommit(ctx.db, {
      cardKey: card.key,
      sha: 'abc1234',
      message: 'real commit',
      committedAt: '2026-01-01T00:00:00.000Z'
    })
    // Attach the sentinel last: a real-commit attach prunes any sentinel, but a
    // sentinel attach leaves the real commit, so both rows coexist here.
    await attachCardCommit(ctx.db, {
      cardKey: card.key,
      sha: WORKING_TREE_SHA,
      message: 'uncommitted',
      committedAt: null
    })

    const commits = await listCardCommits(ctx.db, card.id)
    expect(commits[0]!.sha).toBe(WORKING_TREE_SHA)
    expect(commits[1]!.sha).toBe('abc1234')
  })
})
