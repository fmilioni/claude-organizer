import { and, eq, inArray, sql } from 'drizzle-orm'

import { type Database, schema } from '@claude-organizer/db'
import { SYSTEM_SETTINGS_ID } from '@claude-organizer/db/schema'
import type {
  SystemSettingsRow,
  UserRole,
  UserStatus
} from '@claude-organizer/shared'

import { ConflictError } from './errors'

export async function getUserAuthz(db: Database, userId: string) {
  const [row] = await db
    .select()
    .from(schema.userAuthz)
    .where(eq(schema.userAuthz.userId, userId))
    .limit(1)
  return row ?? null
}

// Only approved users have any access. Admin and the `allProjects` flag short-
// circuit to every project (including ones created later); otherwise it is the
// explicit per-project grant.
export async function canAccessProject(
  db: Database,
  userId: string,
  projectId: string
): Promise<boolean> {
  const authz = await getUserAuthz(db, userId)
  if (!authz || authz.status !== 'approved') return false
  if (authz.role === 'admin' || authz.allProjects) return true
  const [row] = await db
    .select({ projectId: schema.userProjectAccess.projectId })
    .from(schema.userProjectAccess)
    .where(
      and(
        eq(schema.userProjectAccess.userId, userId),
        eq(schema.userProjectAccess.projectId, projectId)
      )
    )
    .limit(1)
  return Boolean(row)
}

// Whether an explicit per-project grant row exists. The caller must have already
// confirmed the user is approved and not admin/allProjects (the guard does), so
// this is just the grant lookup — no redundant user_authz read.
export async function hasProjectGrant(
  db: Database,
  userId: string,
  projectId: string
): Promise<boolean> {
  const [row] = await db
    .select({ projectId: schema.userProjectAccess.projectId })
    .from(schema.userProjectAccess)
    .where(
      and(
        eq(schema.userProjectAccess.userId, userId),
        eq(schema.userProjectAccess.projectId, projectId)
      )
    )
    .limit(1)
  return Boolean(row)
}

// `'all'` means unrestricted (admin or allProjects flag) — callers skip project
// filtering. An empty array means a pending/unscoped user sees nothing.
export async function listAccessibleProjectIds(
  db: Database,
  userId: string
): Promise<'all' | string[]> {
  const authz = await getUserAuthz(db, userId)
  if (!authz || authz.status !== 'approved') return []
  if (authz.role === 'admin' || authz.allProjects) return 'all'
  const rows = await db
    .select({ projectId: schema.userProjectAccess.projectId })
    .from(schema.userProjectAccess)
    .where(eq(schema.userProjectAccess.userId, userId))
  return rows.map(r => r.projectId)
}

export interface SetUserAuthzInput {
  role: UserRole
  allProjects: boolean
  projectIds?: string[]
  // Only the approval flow (CO-167) passes this; left out, status keeps its row
  // value (or the 'pending' default on insert).
  status?: UserStatus
}

// Assigns role + project scope in one transaction and replaces the explicit
// grants wholesale. Upsert (not update) so it is self-sufficient — it must not
// depend on the create hook (CO-165) having inserted the row first.
// `allProjects=true` clears the per-project rows so they never drift; admins are
// unrestricted regardless of what is stored here.
export async function setUserAuthz(
  db: Database,
  userId: string,
  input: SetUserAuthzInput
) {
  const projectIds
    = input.role === 'admin' || input.allProjects ? [] : (input.projectIds ?? [])
  const statusField = input.status ? { status: input.status } : {}
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.userAuthz)
      .values({
        userId,
        role: input.role,
        allProjects: input.allProjects,
        ...statusField
      })
      .onConflictDoUpdate({
        target: schema.userAuthz.userId,
        set: {
          role: input.role,
          allProjects: input.allProjects,
          updatedAt: sql`now()`,
          ...statusField
        }
      })
      .returning()
    await tx
      .delete(schema.userProjectAccess)
      .where(eq(schema.userProjectAccess.userId, userId))
    if (projectIds.length > 0) {
      await tx
        .insert(schema.userProjectAccess)
        .values(projectIds.map(projectId => ({ userId, projectId })))
    }
    return row!
  })
}

export interface ApproveUserInput {
  role: UserRole
  allProjects: boolean
  projectIds?: string[]
}

// Approval = set status 'approved' alongside role/scope, reusing setUserAuthz.
export async function approveUser(
  db: Database,
  userId: string,
  input: ApproveUserInput
) {
  return setUserAuthz(db, userId, { ...input, status: 'approved' })
}

// Hard delete (cascade drops sessions/accounts/user_authz/user_project_access;
// comments.userId set-null keeps the comments, now author-less). Refuses the
// *last* admin — that would lock everyone out of the admin-only surface.
// Returns the deleted id, or null when the user doesn't exist.
export async function deleteUser(db: Database, userId: string) {
  return db.transaction(async (tx) => {
    // Lock the whole admin set up front (consistent lock order → no deadlock)
    // so the last-admin count can't go stale between the guard and the delete
    // under concurrent admin deletions.
    const admins = await tx
      .select({ userId: schema.userAuthz.userId })
      .from(schema.userAuthz)
      .where(eq(schema.userAuthz.role, 'admin'))
      .orderBy(schema.userAuthz.userId)
      .for('update')
    const targetIsAdmin = admins.some(a => a.userId === userId)
    if (targetIsAdmin && admins.length <= 1) {
      throw new ConflictError('Cannot remove the last admin')
    }
    const [row] = await tx
      .delete(schema.users)
      .where(eq(schema.users.id, userId))
      .returning({ id: schema.users.id })
    return row ?? null
  })
}

// Every user with their role/status, for the admin management page. innerJoin
// so a user with no authz row (shouldn't happen — the create hook always makes
// one) is simply absent rather than half-populated.
export async function listAllUsers(db: Database) {
  return db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      image: schema.users.image,
      role: schema.userAuthz.role,
      status: schema.userAuthz.status,
      createdAt: schema.users.createdAt
    })
    .from(schema.userAuthz)
    .innerJoin(schema.users, eq(schema.userAuthz.userId, schema.users.id))
    .orderBy(schema.users.createdAt)
}

const DEFAULT_SYSTEM_SETTINGS = {
  authEnabled: true,
  keepDiffsOnArchive: false
} as const

export async function getSystemSettings(
  db: Database
): Promise<Pick<SystemSettingsRow, 'authEnabled' | 'keepDiffsOnArchive'>> {
  const [row] = await db
    .select({
      authEnabled: schema.systemSettings.authEnabled,
      keepDiffsOnArchive: schema.systemSettings.keepDiffsOnArchive
    })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.id, SYSTEM_SETTINGS_ID))
    .limit(1)
  return row ?? DEFAULT_SYSTEM_SETTINGS
}

export async function setAuthEnabled(db: Database, authEnabled: boolean) {
  const [row] = await db
    .insert(schema.systemSettings)
    .values({ id: SYSTEM_SETTINGS_ID, authEnabled })
    .onConflictDoUpdate({
      target: schema.systemSettings.id,
      set: { authEnabled, updatedAt: sql`now()` }
    })
    .returning({ authEnabled: schema.systemSettings.authEnabled })
  return row!
}

export async function setKeepDiffsOnArchive(
  db: Database,
  keepDiffsOnArchive: boolean
) {
  const [row] = await db
    .insert(schema.systemSettings)
    .values({ id: SYSTEM_SETTINGS_ID, keepDiffsOnArchive })
    .onConflictDoUpdate({
      target: schema.systemSettings.id,
      set: { keepDiffsOnArchive, updatedAt: sql`now()` }
    })
    .returning({
      keepDiffsOnArchive: schema.systemSettings.keepDiffsOnArchive
    })
  return row!
}

// Arbitrary fixed key serializing the first-boot admin claim via a transaction-
// scoped advisory lock — only its uniqueness within this app's advisory-lock
// space matters.
const ADMIN_CLAIM_LOCK = 4242100165

// Creates the user_authz row for a just-created better-auth user. The claim
// keys on "no admin exists yet" (not "no users"), so the first user ever is
// claimed as admin/approved/all-projects and the rest are pending users — and
// the claim re-opens if every admin is later removed (a recovery path). The
// advisory lock serializes near-simultaneous first logins so they can't both
// claim admin; onConflictDoNothing makes a repeated hook run idempotent (never
// downgrades an existing admin). Returns true when this user became the admin.
export async function claimOrCreateUserAuthz(
  db: Database,
  userId: string
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADMIN_CLAIM_LOCK})`)
    const [admin] = await tx
      .select({ userId: schema.userAuthz.userId })
      .from(schema.userAuthz)
      .where(eq(schema.userAuthz.role, 'admin'))
      .limit(1)
    const isFirst = !admin
    await tx
      .insert(schema.userAuthz)
      .values({
        userId,
        role: isFirst ? 'admin' : 'user',
        status: isFirst ? 'approved' : 'pending',
        allProjects: isFirst
      })
      .onConflictDoNothing()
    return isFirst
  })
}

// Entity → owning projectId, for the API's access guard to check a route's
// target before the handler runs. Lightweight single-column lookups (no joins
// beyond comment→card). Returns null when the id doesn't exist.
export type ProjectScopedEntity
  = | 'card'
    | 'cardKey'
    | 'sprint'
    | 'doc'
    | 'tag'
    | 'intakeItem'
    | 'comment'

export async function resolveEntityProjectId(
  db: Database,
  kind: ProjectScopedEntity,
  id: string
): Promise<string | null> {
  switch (kind) {
    case 'card': {
      const [row] = await db
        .select({ projectId: schema.cards.projectId })
        .from(schema.cards)
        .where(eq(schema.cards.id, id))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'cardKey': {
      // Keys are unique only per project; the guard matches getCardByKey's same
      // unscoped lookup, so guard and handler agree on the row (no cross-project
      // leak) — at worst a duplicate prefix causes a false denial. Distinct
      // prefixes (enforced on import) keep this from happening in practice.
      const [row] = await db
        .select({ projectId: schema.cards.projectId })
        .from(schema.cards)
        .where(eq(schema.cards.key, id))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'sprint': {
      const [row] = await db
        .select({ projectId: schema.sprints.projectId })
        .from(schema.sprints)
        .where(eq(schema.sprints.id, id))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'doc': {
      const [row] = await db
        .select({ projectId: schema.docs.projectId })
        .from(schema.docs)
        .where(eq(schema.docs.id, id))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'tag': {
      const [row] = await db
        .select({ projectId: schema.tags.projectId })
        .from(schema.tags)
        .where(eq(schema.tags.id, id))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'intakeItem': {
      const [row] = await db
        .select({ projectId: schema.intakeItems.projectId })
        .from(schema.intakeItems)
        .where(eq(schema.intakeItems.id, id))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'comment': {
      const [row] = await db
        .select({ projectId: schema.cards.projectId })
        .from(schema.comments)
        .innerJoin(schema.cards, eq(schema.comments.cardId, schema.cards.id))
        .where(eq(schema.comments.id, id))
        .limit(1)
      return row?.projectId ?? null
    }
  }
}

// Distinct owning projects for a set of comments (the only route whose payload
// can span projects). Empty input → empty set (caller treats as no-op).
export async function resolveCommentsProjectIds(
  db: Database,
  commentIds: string[]
): Promise<string[]> {
  if (commentIds.length === 0) return []
  const rows = await db
    .selectDistinct({ projectId: schema.cards.projectId })
    .from(schema.comments)
    .innerJoin(schema.cards, eq(schema.comments.cardId, schema.cards.id))
    .where(inArray(schema.comments.id, commentIds))
  return rows.map(r => r.projectId)
}

// Distinct owning projects for a set of cards. Used to access-check a reorder,
// which mutates every card id in its payload — checking only one would let a
// user move cards in projects they can't access.
export async function resolveCardsProjectIds(
  db: Database,
  cardIds: string[]
): Promise<string[]> {
  if (cardIds.length === 0) return []
  const rows = await db
    .selectDistinct({ projectId: schema.cards.projectId })
    .from(schema.cards)
    .where(inArray(schema.cards.id, cardIds))
  return rows.map(r => r.projectId)
}
