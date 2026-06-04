import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { schema } from '@claude-organizer/db'

import {
  addComment,
  addTagToCard,
  createCard,
  createProject,
  createSprint,
  createTag,
  exportProject,
  importBackup,
  serializeBackup
} from '../src/index'
import { freshProject, useTestDb } from './helpers'

const ctx = useTestDb()

async function seedProject() {
  const project = await freshProject(ctx.db)
  const sprint = await createSprint(ctx.db, {
    projectId: project.id,
    name: 'S1'
  })
  const card = await createCard(ctx.db, {
    projectId: project.id,
    sprintId: sprint.id,
    title: 'Card A'
  })
  const tag = await createTag(ctx.db, { projectId: project.id, name: 'area' })
  await addTagToCard(ctx.db, card.id, tag.id)
  await addComment(ctx.db, { cardId: card.id, author: 'user', bodyMd: 'hi' })
  return { project, card }
}

const cardsOf = (projectId: string) =>
  ctx.db.select().from(schema.cards).where(eq(schema.cards.projectId, projectId))

describe('importBackup — restore as new', () => {
  it('recreates a project with fresh ids but preserved keys', async () => {
    const { project, card } = await seedProject()
    const env = await exportProject(ctx.db, project.id)

    const { projectIds } = await importBackup(ctx.db, serializeBackup(env))
    expect(projectIds).toHaveLength(1)
    const newId = projectIds[0]!
    expect(newId).not.toBe(project.id)

    const imported = await cardsOf(newId)
    expect(imported.map(c => c.key)).toContain(card.key)
    expect(imported.every(c => c.id !== card.id)).toBe(true)

    const [newProject] = await ctx.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, newId))
    const [orig] = await ctx.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id))
    expect(newProject!.nextKeySeq).toBe(orig!.nextKeySeq)
  })

  it('deterministically suffixes a colliding slug/keyPrefix', async () => {
    const { project } = await seedProject()
    const env = await exportProject(ctx.db, project.id)
    const gz = serializeBackup(env)

    const first = await importBackup(ctx.db, gz)
    const second = await importBackup(ctx.db, gz)

    const [p1] = await ctx.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, first.projectIds[0]!))
    const [p2] = await ctx.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, second.projectIds[0]!))
    expect(p2!.slug).not.toBe(p1!.slug)
    expect(p2!.keyPrefix).not.toBe(p1!.keyPrefix)
  })

  it('suffixes only the field that collides, leaving the free one untouched', async () => {
    const { project } = await seedProject()
    const blocker = await freshProject(ctx.db, 'ZZ')

    const slugClash = await exportProject(ctx.db, project.id)
    const a = slugClash.data.projects![0] as { slug: string; keyPrefix: string }
    a.slug = blocker.slug
    a.keyPrefix = 'QQ'
    const r1 = await importBackup(ctx.db, serializeBackup(slugClash))
    const [imp1] = await ctx.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, r1.projectIds[0]!))
    expect(imp1!.slug).not.toBe(blocker.slug)
    expect(imp1!.keyPrefix).toBe('QQ')

    const prefixClash = await exportProject(ctx.db, project.id)
    const b = prefixClash.data.projects![0] as { slug: string; keyPrefix: string }
    b.slug = 'a-free-and-unused-slug'
    b.keyPrefix = blocker.keyPrefix
    const r2 = await importBackup(ctx.db, serializeBackup(prefixClash))
    const [imp2] = await ctx.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, r2.projectIds[0]!))
    expect(imp2!.slug).toBe('a-free-and-unused-slug')
    expect(imp2!.keyPrefix).not.toBe(blocker.keyPrefix)
  })

  it('caps a suffixed slug at 60 chars on collision', async () => {
    const longSlug = 'a'.repeat(60)
    await createProject(ctx.db, {
      name: 'Long',
      slug: longSlug,
      keyPrefix: 'LS'
    })
    const { project } = await seedProject()
    const env = await exportProject(ctx.db, project.id)
    const p = env.data.projects![0] as { slug: string; keyPrefix: string }
    p.slug = longSlug
    p.keyPrefix = 'XY'
    const { projectIds } = await importBackup(ctx.db, serializeBackup(env))
    const [imp] = await ctx.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectIds[0]!))
    expect(imp!.slug).not.toBe(longSlug)
    expect(imp!.slug.length).toBeLessThanOrEqual(60)
  })

  it('clamps an over-long slug/keyPrefix even without a collision', async () => {
    const { project } = await seedProject()
    const env = await exportProject(ctx.db, project.id)
    const p = env.data.projects![0] as { slug: string; keyPrefix: string }
    p.slug = 'b'.repeat(80)
    p.keyPrefix = 'C'.repeat(15)
    const { projectIds } = await importBackup(ctx.db, serializeBackup(env))
    const [imp] = await ctx.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectIds[0]!))
    expect(imp!.slug.length).toBeLessThanOrEqual(60)
    expect(imp!.keyPrefix.length).toBeLessThanOrEqual(10)
  })

  it('migrates a v0 backup (no intake_items) up to the current format', async () => {
    const { project } = await seedProject()
    const env = await exportProject(ctx.db, project.id)

    const { intake_items, ...dataWithoutIntake } = env.data
    void intake_items
    const v0 = serializeBackup({
      version: 0,
      exportedAt: env.exportedAt,
      scope: 'project',
      projectIds: env.projectIds,
      data: dataWithoutIntake
    })

    const { projectIds } = await importBackup(ctx.db, v0)
    expect(projectIds).toHaveLength(1)
  })

  it('rejects a backup from a newer format version', async () => {
    const { project } = await seedProject()
    const env = await exportProject(ctx.db, project.id)
    const future = serializeBackup({ ...env, version: 999 })

    await expect(importBackup(ctx.db, future)).rejects.toThrow()
  })
})
