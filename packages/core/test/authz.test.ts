import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { schema } from '@claude-organizer/db'

import {
  addComment,
  approveUser,
  canAccessProject,
  claimOrCreateUserAuthz,
  ConflictError,
  createCard,
  deleteUser,
  getSystemSettings,
  getUserAuthz,
  listAccessibleProjectIds,
  listAllUsers,
  resolveCommentsProjectIds,
  resolveEntityProjectId,
  setAuthEnabled,
  setKeepDiffsOnArchive,
  setUserAuthz
} from '../src/index'
import { freshProject, uniqueKeyPrefix, useTestDb } from './helpers'

const ctx = useTestDb()

// This is the only suite that touches users/user_authz, so wiping users (which
// cascades to user_authz) between cases is safe even with the shared ephemeral
// Postgres — no other test file writes these tables.
beforeEach(async () => {
  await ctx.db.delete(schema.users)
})

async function makeUser(db: typeof ctx.db) {
  const id = `usr_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  await db.insert(schema.users).values({ id, name: 'T', email: `${id}@t.test` })
  return id
}

describe('claimOrCreateUserAuthz', () => {
  it('claims the first user as admin/approved/all-projects, rest pending', async () => {
    const u1 = await makeUser(ctx.db)
    expect(await claimOrCreateUserAuthz(ctx.db, u1)).toBe(true)
    expect(await getUserAuthz(ctx.db, u1)).toMatchObject({
      role: 'admin',
      status: 'approved',
      allProjects: true
    })

    const u2 = await makeUser(ctx.db)
    expect(await claimOrCreateUserAuthz(ctx.db, u2)).toBe(false)
    expect(await getUserAuthz(ctx.db, u2)).toMatchObject({
      role: 'user',
      status: 'pending',
      allProjects: false
    })
  })

  it('is idempotent when the hook runs twice for the same user', async () => {
    const u1 = await makeUser(ctx.db)
    expect(await claimOrCreateUserAuthz(ctx.db, u1)).toBe(true)
    expect(await claimOrCreateUserAuthz(ctx.db, u1)).toBe(false)
    expect(await getUserAuthz(ctx.db, u1)).toMatchObject({ role: 'admin' })
  })

  it('serializes concurrent first logins down to a single admin', async () => {
    const u1 = await makeUser(ctx.db)
    const u2 = await makeUser(ctx.db)
    const results = await Promise.all([
      claimOrCreateUserAuthz(ctx.db, u1),
      claimOrCreateUserAuthz(ctx.db, u2)
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    const admins = await ctx.db
      .select()
      .from(schema.userAuthz)
      .where(eq(schema.userAuthz.role, 'admin'))
    expect(admins).toHaveLength(1)
  })
})

describe('project access', () => {
  it('admin reaches every project; a pending user reaches none', async () => {
    const p = await freshProject(ctx.db)
    const admin = await makeUser(ctx.db)
    await claimOrCreateUserAuthz(ctx.db, admin)
    expect(await canAccessProject(ctx.db, admin, p.id)).toBe(true)
    expect(await listAccessibleProjectIds(ctx.db, admin)).toBe('all')

    const pending = await makeUser(ctx.db)
    await claimOrCreateUserAuthz(ctx.db, pending)
    expect(await canAccessProject(ctx.db, pending, p.id)).toBe(false)
    expect(await listAccessibleProjectIds(ctx.db, pending)).toEqual([])
  })

  it('a subset user is limited to granted projects; allProjects covers later ones', async () => {
    const p1 = await freshProject(ctx.db)
    const p2 = await freshProject(ctx.db)
    const admin = await makeUser(ctx.db)
    await claimOrCreateUserAuthz(ctx.db, admin)

    const u = await makeUser(ctx.db)
    await claimOrCreateUserAuthz(ctx.db, u)
    await approveUser(ctx.db, u, {
      role: 'user',
      allProjects: false,
      projectIds: [p1.id]
    })
    expect(await canAccessProject(ctx.db, u, p1.id)).toBe(true)
    expect(await canAccessProject(ctx.db, u, p2.id)).toBe(false)
    expect(await listAccessibleProjectIds(ctx.db, u)).toEqual([p1.id])

    await setUserAuthz(ctx.db, u, { role: 'user', allProjects: true })
    const p3 = await freshProject(ctx.db)
    expect(await canAccessProject(ctx.db, u, p3.id)).toBe(true)
    expect(await listAccessibleProjectIds(ctx.db, u)).toBe('all')
  })

  it('resolves an entity to its owning project (null when missing)', async () => {
    // Unique key prefix: card keys repeat across the default-'CO' projects other
    // test files create, so a by-key lookup must not collide (helper caveat).
    const p = await freshProject(ctx.db, uniqueKeyPrefix())
    const card = await createCard(ctx.db, { projectId: p.id, title: 'X' })
    expect(await resolveEntityProjectId(ctx.db, 'card', card.id)).toBe(p.id)
    expect(await resolveEntityProjectId(ctx.db, 'cardKey', card.key)).toBe(p.id)
    expect(await resolveEntityProjectId(ctx.db, 'card', 'missing')).toBeNull()
  })

  it('resolveCommentsProjectIds spans projects and is empty for no input', async () => {
    const p1 = await freshProject(ctx.db, uniqueKeyPrefix())
    const p2 = await freshProject(ctx.db, uniqueKeyPrefix())
    const c1 = await createCard(ctx.db, { projectId: p1.id, title: 'A' })
    const c2 = await createCard(ctx.db, { projectId: p2.id, title: 'B' })
    const cm1 = await addComment(ctx.db, {
      cardId: c1.id,
      author: 'user',
      bodyMd: 'x'
    })
    const cm2 = await addComment(ctx.db, {
      cardId: c2.id,
      author: 'user',
      bodyMd: 'y'
    })
    const ids = await resolveCommentsProjectIds(ctx.db, [cm1.id, cm2.id])
    expect([...ids].sort()).toEqual([p1.id, p2.id].sort())
    expect(await resolveCommentsProjectIds(ctx.db, [])).toEqual([])
  })
})

describe('user management', () => {
  it('lists every user with role/status and approves with role+scope', async () => {
    const p = await freshProject(ctx.db)
    const admin = await makeUser(ctx.db)
    await claimOrCreateUserAuthz(ctx.db, admin)
    const u = await makeUser(ctx.db)
    await claimOrCreateUserAuthz(ctx.db, u)

    const listed = await listAllUsers(ctx.db)
    expect(listed.find(x => x.id === admin)).toMatchObject({
      role: 'admin',
      status: 'approved'
    })
    expect(listed.find(x => x.id === u)).toMatchObject({
      role: 'user',
      status: 'pending'
    })

    await approveUser(ctx.db, u, {
      role: 'user',
      allProjects: false,
      projectIds: [p.id]
    })
    expect(await getUserAuthz(ctx.db, u)).toMatchObject({
      status: 'approved',
      role: 'user',
      allProjects: false
    })
    expect(await canAccessProject(ctx.db, u, p.id)).toBe(true)
    expect(
      (await listAllUsers(ctx.db)).find(x => x.id === u)
    ).toMatchObject({ status: 'approved' })
  })

  it('deleteUser hard-deletes the account (cascade drops user_authz)', async () => {
    const admin = await makeUser(ctx.db)
    await claimOrCreateUserAuthz(ctx.db, admin)
    const u = await makeUser(ctx.db)
    await claimOrCreateUserAuthz(ctx.db, u)

    expect(await deleteUser(ctx.db, u)).toMatchObject({ id: u })
    expect(await getUserAuthz(ctx.db, u)).toBeNull()
    expect((await listAllUsers(ctx.db)).map(x => x.id)).not.toContain(u)
  })

  it('refuses to delete the last admin, but allows it once another exists', async () => {
    const a1 = await makeUser(ctx.db)
    await claimOrCreateUserAuthz(ctx.db, a1)

    await expect(deleteUser(ctx.db, a1)).rejects.toThrow(ConflictError)
    expect(await getUserAuthz(ctx.db, a1)).not.toBeNull()

    const a2 = await makeUser(ctx.db)
    await claimOrCreateUserAuthz(ctx.db, a2)
    await approveUser(ctx.db, a2, { role: 'admin', allProjects: true })

    expect(await deleteUser(ctx.db, a1)).toMatchObject({ id: a1 })
    expect(await getUserAuthz(ctx.db, a1)).toBeNull()
  })

  it('returns null when the user does not exist', async () => {
    expect(await deleteUser(ctx.db, 'usr_missing')).toBeNull()
  })
})

describe('system settings', () => {
  it('persists and toggles authEnabled', async () => {
    expect(await setAuthEnabled(ctx.db, false)).toEqual({ authEnabled: false })
    expect(await getSystemSettings(ctx.db)).toMatchObject({ authEnabled: false })
    expect(await setAuthEnabled(ctx.db, true)).toEqual({ authEnabled: true })
    expect(await getSystemSettings(ctx.db)).toMatchObject({ authEnabled: true })
  })

  it('persists and toggles keepDiffsOnArchive (default off)', async () => {
    expect(await getSystemSettings(ctx.db)).toMatchObject({
      keepDiffsOnArchive: false
    })
    expect(await setKeepDiffsOnArchive(ctx.db, true)).toEqual({
      keepDiffsOnArchive: true
    })
    expect(await getSystemSettings(ctx.db)).toMatchObject({
      keepDiffsOnArchive: true
    })
    expect(await setKeepDiffsOnArchive(ctx.db, false)).toEqual({
      keepDiffsOnArchive: false
    })
  })
})
