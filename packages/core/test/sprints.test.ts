import { describe, expect, it } from 'vitest'

import {
  archiveSprint,
  completeSprint,
  createSprint,
  getActiveSprints,
  getSprint,
  listSprints,
  reopenSprint,
  startSprint
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()

describe('sprint lifecycle', () => {
  it('allows several active sprints at once: starting a second does not complete the first', async () => {
    const project = await freshProject(ctx.db)
    const s1 = await createSprint(ctx.db, { projectId: project.id, name: 'S1' })
    const s2 = await createSprint(ctx.db, { projectId: project.id, name: 'S2' })
    expect(s1.status).toBe('planned')
    expect(s2.status).toBe('planned')

    await startSprint(ctx.db, s1.id)
    expect((await getActiveSprints(ctx.db, project.id)).map(s => s.id)).toEqual([
      s1.id
    ])

    await startSprint(ctx.db, s2.id)
    const active = await getActiveSprints(ctx.db, project.id)
    expect(active.map(s => s.id).sort()).toEqual([s1.id, s2.id].sort())
    expect((await getSprint(ctx.db, s1.id))?.status).toBe('active')
    expect((await getSprint(ctx.db, s2.id))?.status).toBe('active')
  })

  it('fills startsAt on start and endsAt on complete automatically', async () => {
    const project = await freshProject(ctx.db)
    const sprint = await createSprint(ctx.db, {
      projectId: project.id,
      name: 'Dates'
    })
    expect(sprint.startsAt).toBeNull()
    expect(sprint.endsAt).toBeNull()

    const started = await startSprint(ctx.db, sprint.id)
    expect(started?.startsAt).toBeInstanceOf(Date)

    const completed = await completeSprint(ctx.db, sprint.id)
    expect(completed?.status).toBe('completed')
    expect(completed?.endsAt).toBeInstanceOf(Date)
  })

  it('does not leak active sprints across projects', async () => {
    const p1 = await freshProject(ctx.db)
    const p2 = await freshProject(ctx.db)
    const s1 = await createSprint(ctx.db, { projectId: p1.id, name: 'P1S' })
    await startSprint(ctx.db, s1.id)

    expect(await getActiveSprints(ctx.db, p2.id)).toEqual([])
    expect((await getActiveSprints(ctx.db, p1.id)).map(s => s.id)).toEqual([
      s1.id
    ])
  })
})

describe('reopening a sprint', () => {
  it('moves a completed sprint back to planned, clears endsAt, never activates', async () => {
    const project = await freshProject(ctx.db)
    const sprint = await createSprint(ctx.db, { projectId: project.id, name: 'R' })
    await startSprint(ctx.db, sprint.id)
    const completed = await completeSprint(ctx.db, sprint.id)
    expect(completed?.status).toBe('completed')
    expect(completed?.endsAt).toBeInstanceOf(Date)

    const reopened = await reopenSprint(ctx.db, sprint.id)
    expect(reopened?.status).toBe('planned')
    expect(reopened?.endsAt).toBeNull()
    expect(await getActiveSprints(ctx.db, project.id)).toEqual([])
  })

  it('unarchives an archived sprint as part of reopening', async () => {
    const project = await freshProject(ctx.db)
    const sprint = await createSprint(ctx.db, { projectId: project.id, name: 'A' })
    await archiveSprint(ctx.db, sprint.id)

    const reopened = await reopenSprint(ctx.db, sprint.id)
    expect(reopened?.status).toBe('planned')
    expect(reopened?.archivedAt).toBeNull()

    const listed = await listSprints(ctx.db, project.id)
    expect(listed.some(s => s.id === sprint.id)).toBe(true)
  })
})
