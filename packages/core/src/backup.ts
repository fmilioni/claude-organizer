import { gunzipSync, gzipSync } from 'node:zlib'

import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { createId, type Database, schema } from '@claude-organizer/db'
import {
  BACKUP_FORMAT_VERSION,
  type BackupEnvelope,
  type BackupScope,
  type CardCommitRow,
  type CardRow,
  type CommentRow,
  type DocRow,
  type IntakeItemRow,
  type ProjectRow,
  type RoadmapRow,
  type SprintRow,
  type TagRow
} from '@claude-organizer/shared'

import { InputError } from './errors'

// Project-domain tables, parents before children (FK-safe order for the
// importer, CO-142). The coverage test asserts every schema table sits in
// exactly one of BACKUP_TABLE_NAMES or NON_BACKUP_TABLE_NAMES — the "nothing
// left behind" guarantee.
export const BACKUP_TABLE_NAMES = [
  'projects',
  'roadmaps',
  'sprints',
  'cards',
  'comments',
  'docs',
  'tags',
  'card_tags',
  'card_blockers',
  'card_commits',
  'intake_items'
] as const

// Identity/system tables deliberately kept OUT of project backups: a backup
// imports as a brand-new copy, so duplicating users/sessions or system config
// would be wrong. Listed (not just omitted) so the coverage test forces a
// conscious choice for every future table.
export const NON_BACKUP_TABLE_NAMES = [
  'users',
  'sessions',
  'accounts',
  'verifications',
  'oauth_applications',
  'oauth_access_tokens',
  'oauth_consents',
  'user_authz',
  'user_project_access',
  'card_claims',
  'system_settings'
] as const

function envelope(
  scope: BackupScope,
  projectIds: string[],
  data: Record<string, unknown[]>
): BackupEnvelope {
  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    scope,
    projectIds,
    data
  }
}

const emptyData = (): Record<string, unknown[]> =>
  Object.fromEntries(BACKUP_TABLE_NAMES.map(name => [name, []]))

export async function exportAll(db: Database): Promise<BackupEnvelope> {
  const [
    projects,
    roadmaps,
    sprints,
    cards,
    comments,
    docs,
    tags,
    cardTags,
    cardBlockers,
    cardCommits,
    intakeItems
  ] = await Promise.all([
    db.select().from(schema.projects),
    db.select().from(schema.roadmaps),
    db.select().from(schema.sprints),
    db.select().from(schema.cards),
    db.select().from(schema.comments),
    db.select().from(schema.docs),
    db.select().from(schema.tags),
    db.select().from(schema.cardTags),
    db.select().from(schema.cardBlockers),
    db.select().from(schema.cardCommits),
    db.select().from(schema.intakeItems)
  ])
  return envelope(
    'all',
    projects.map(p => p.id),
    {
      projects,
      roadmaps,
      sprints,
      cards,
      comments,
      docs,
      tags,
      card_tags: cardTags,
      card_blockers: cardBlockers,
      card_commits: cardCommits,
      intake_items: intakeItems
    }
  )
}

export async function exportProject(
  db: Database,
  projectId: string
): Promise<BackupEnvelope> {
  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
  if (!projects.length) return envelope('project', [], emptyData())

  const cards = await db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.projectId, projectId))
  const cardIds = cards.map(c => c.id)
  const ofCards = <T>(query: Promise<T[]>): Promise<T[]> =>
    cardIds.length ? query : Promise.resolve([])

  const [
    roadmaps,
    sprints,
    comments,
    docs,
    tags,
    cardTags,
    cardBlockers,
    cardCommits,
    intakeItems
  ] = await Promise.all([
    db
      .select()
      .from(schema.roadmaps)
      .where(eq(schema.roadmaps.projectId, projectId)),
    db
      .select()
      .from(schema.sprints)
      .where(eq(schema.sprints.projectId, projectId)),
    ofCards(
      db
        .select()
        .from(schema.comments)
        .where(inArray(schema.comments.cardId, cardIds))
    ),
    db.select().from(schema.docs).where(eq(schema.docs.projectId, projectId)),
    db.select().from(schema.tags).where(eq(schema.tags.projectId, projectId)),
    ofCards(
      db
        .select()
        .from(schema.cardTags)
        .where(inArray(schema.cardTags.cardId, cardIds))
    ),
    // Only intra-project blocker edges: both ends must live in this project so
    // the backup stays self-contained (no dangling FK for the importer).
    ofCards(
      db
        .select()
        .from(schema.cardBlockers)
        .where(
          and(
            inArray(schema.cardBlockers.blockedCardId, cardIds),
            inArray(schema.cardBlockers.blockerCardId, cardIds)
          )
        )
    ),
    ofCards(
      db
        .select()
        .from(schema.cardCommits)
        .where(inArray(schema.cardCommits.cardId, cardIds))
    ),
    db
      .select()
      .from(schema.intakeItems)
      .where(eq(schema.intakeItems.projectId, projectId))
  ])

  return envelope(
    'project',
    projects.map(p => p.id),
    {
      projects,
      roadmaps,
      sprints,
      cards,
      comments,
      docs,
      tags,
      card_tags: cardTags,
      card_blockers: cardBlockers,
      card_commits: cardCommits,
      intake_items: intakeItems
    }
  )
}

export function serializeBackup(env: BackupEnvelope): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(env), 'utf8'))
}

type BackupData = Record<string, unknown[]>

// Migrators that lift an old backup payload to the next format version:
// MIGRATORS[v] turns a v-payload into a (v+1)-payload. Append one per format
// bump; the chain runs them in order so an old backup opens on the current
// server (the central guarantee of CO-140).
const MIGRATORS: Array<(data: BackupData) => BackupData> = [
  // v0 → v1: `intake_items` joined the schema; older backups lack the table.
  data => ({ ...data, intake_items: data.intake_items ?? [] })
]

const backupEnvelopeSchema = z
  .object({
    version: z.number().int().nonnegative(),
    exportedAt: z.string(),
    scope: z.enum(['project', 'all']),
    projectIds: z.array(z.string()),
    data: z.record(z.string(), z.array(z.record(z.string(), z.unknown())))
  })
  .strict()

function migrateData(version: number, data: BackupData): BackupData {
  if (version > BACKUP_FORMAT_VERSION) {
    throw new InputError(
      `backup format v${version} is newer than this server (v${BACKUP_FORMAT_VERSION})`
    )
  }
  let out = data
  for (let v = version; v < BACKUP_FORMAT_VERSION; v++) {
    const migrate = MIGRATORS[v]
    if (!migrate) throw new InputError(`no migration path from backup format v${v}`)
    out = migrate(out)
  }
  return out
}

const toDate = (v: string | null | undefined) => (v == null ? null : new Date(v))

export interface ImportResult {
  projectIds: string[]
}

/**
 * Import a backup as a brand-new copy (non-destructive): old internal ids are
 * remapped to fresh ones and FKs reattached, while human keys (`CO-N`) and the
 * project's `nextKeySeq` are preserved. A slug/keyPrefix already taken in the
 * destination is deterministically suffixed. Runs the version-migration chain
 * first, so an older backup opens on the current server.
 */
export async function importBackup(
  db: Database,
  gzipped: Buffer | Uint8Array,
  opts: { mode?: 'new' } = {}
): Promise<ImportResult> {
  const mode = opts.mode ?? 'new'
  if (mode !== 'new') throw new InputError(`unsupported import mode: ${mode}`)

  let parsed: unknown
  try {
    parsed = JSON.parse(gunzipSync(gzipped).toString('utf8'))
  } catch {
    throw new InputError('invalid backup file: not a gzipped JSON envelope')
  }

  const env = backupEnvelopeSchema.safeParse(parsed)
  if (!env.success) throw new InputError('invalid backup envelope')

  const data = migrateData(env.data.version, env.data.data)
  const projectIds = await restoreAsNew(db, data)
  return { projectIds }
}

async function restoreAsNew(db: Database, data: BackupData): Promise<string[]> {
  return db.transaction(async (tx) => {
    const P: Record<string, string> = {}
    const R: Record<string, string> = {}
    const S: Record<string, string> = {}
    const T: Record<string, string> = {}
    const C: Record<string, string> = {}
    const D: Record<string, string> = {}

    // A slug is unique by constraint; keyPrefix we keep distinct too so future
    // keys stay unambiguous. Each field is suffixed independently — only the one
    // that actually collides moves — checking both the destination DB and the
    // identities allocated earlier in this same run (a scope=all backup can carry
    // projects whose roots collide). Both the base and the suffixed forms are
    // capped to createProject's limits (slug ≤ 60, keyPrefix ≤ 10).
    const takenSlugs = new Set<string>()
    const takenPrefixes = new Set<string>()
    const slugTaken = async (s: string) =>
      takenSlugs.has(s)
      || (
        await tx
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(eq(schema.projects.slug, s))
          .limit(1)
      ).length > 0
    const prefixTaken = async (k: string) =>
      takenPrefixes.has(k)
      || (
        await tx
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(eq(schema.projects.keyPrefix, k))
          .limit(1)
      ).length > 0
    async function uniqueIdentity(slug: string, keyPrefix: string) {
      // Clamp the base up front: a backup's text columns carry no length limit,
      // so an over-long identity must be trimmed to createProject's bounds even
      // when it doesn't collide.
      let s = slug.slice(0, 60)
      for (let n = 2; await slugTaken(s); n++) {
        const suffix = `-${n}`
        s = `${slug.slice(0, 60 - suffix.length)}${suffix}`
      }
      let k = keyPrefix.slice(0, 10)
      for (let n = 2; await prefixTaken(k); n++) {
        const suffix = String(n)
        k = `${keyPrefix.slice(0, 10 - suffix.length)}${suffix}`
      }
      takenSlugs.add(s)
      takenPrefixes.add(k)
      return { slug: s, keyPrefix: k }
    }

    const rows = <T2>(key: string) => (data[key] ?? []) as T2[]
    const projectIds: string[] = []

    for (const p of rows<ProjectRow>('projects')) {
      const id = createId('prj')
      P[p.id] = id
      projectIds.push(id)
      const { slug, keyPrefix } = await uniqueIdentity(p.slug, p.keyPrefix)
      await tx.insert(schema.projects).values({
        id,
        slug,
        name: p.name,
        description: p.description,
        keyPrefix,
        nextKeySeq: p.nextKeySeq,
        repoProvider: p.repoProvider,
        repoWebUrl: p.repoWebUrl,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
        archivedAt: toDate(p.archivedAt)
      })
    }

    for (const r of rows<RoadmapRow>('roadmaps')) {
      const id = createId('rdm')
      R[r.id] = id
      await tx.insert(schema.roadmaps).values({
        id,
        projectId: P[r.projectId]!,
        name: r.name,
        description: r.description,
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt)
      })
    }

    for (const s of rows<SprintRow>('sprints')) {
      const id = createId('spr')
      S[s.id] = id
      await tx.insert(schema.sprints).values({
        id,
        projectId: P[s.projectId]!,
        roadmapId: s.roadmapId ? R[s.roadmapId]! : null,
        name: s.name,
        goal: s.goal,
        status: s.status,
        startsAt: toDate(s.startsAt),
        endsAt: toDate(s.endsAt),
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
        archivedAt: toDate(s.archivedAt)
      })
    }

    for (const t of rows<TagRow>('tags')) {
      const id = createId('tag')
      T[t.id] = id
      await tx.insert(schema.tags).values({
        id,
        projectId: P[t.projectId]!,
        name: t.name,
        color: t.color,
        createdAt: new Date(t.createdAt)
      })
    }

    const cards = rows<CardRow>('cards')
    for (const c of cards) {
      const id = createId('crd')
      C[c.id] = id
      // parentId reattached in a second pass once every card id exists.
      await tx.insert(schema.cards).values({
        id,
        projectId: P[c.projectId]!,
        sprintId: c.sprintId ? S[c.sprintId]! : null,
        parentId: null,
        key: c.key,
        title: c.title,
        summary: c.summary,
        descriptionMd: c.descriptionMd,
        status: c.status,
        priority: c.priority,
        dueDate: toDate(c.dueDate),
        position: c.position,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        archivedAt: toDate(c.archivedAt)
      })
    }
    for (const c of cards) {
      if (c.parentId && C[c.parentId]) {
        await tx
          .update(schema.cards)
          .set({ parentId: C[c.parentId]! })
          .where(eq(schema.cards.id, C[c.id]!))
      }
    }

    for (const cm of rows<CommentRow>('comments')) {
      await tx.insert(schema.comments).values({
        id: createId('cmt'),
        cardId: C[cm.cardId]!,
        author: cm.author,
        bodyMd: cm.bodyMd,
        readByAi: cm.readByAi,
        createdAt: new Date(cm.createdAt)
      })
    }

    const docs = rows<DocRow>('docs')
    for (const d of docs) {
      const id = createId('doc')
      D[d.id] = id
      await tx.insert(schema.docs).values({
        id,
        projectId: P[d.projectId]!,
        parentId: null,
        title: d.title,
        summary: d.summary,
        bodyMd: d.bodyMd,
        kind: d.kind,
        position: d.position,
        createdAt: new Date(d.createdAt),
        updatedAt: new Date(d.updatedAt),
        archivedAt: toDate(d.archivedAt)
      })
    }
    for (const d of docs) {
      if (d.parentId && D[d.parentId]) {
        await tx
          .update(schema.docs)
          .set({ parentId: D[d.parentId]! })
          .where(eq(schema.docs.id, D[d.id]!))
      }
    }

    for (const ct of rows<{ cardId: string, tagId: string }>('card_tags')) {
      if (C[ct.cardId] && T[ct.tagId]) {
        await tx
          .insert(schema.cardTags)
          .values({ cardId: C[ct.cardId]!, tagId: T[ct.tagId]! })
      }
    }

    for (const b of rows<{ blockedCardId: string, blockerCardId: string }>(
      'card_blockers'
    )) {
      if (C[b.blockedCardId] && C[b.blockerCardId]) {
        await tx.insert(schema.cardBlockers).values({
          blockedCardId: C[b.blockedCardId]!,
          blockerCardId: C[b.blockerCardId]!
        })
      }
    }

    for (const cc of rows<CardCommitRow>('card_commits')) {
      await tx.insert(schema.cardCommits).values({
        id: createId('ccm'),
        cardId: C[cc.cardId]!,
        sha: cc.sha,
        message: cc.message,
        stat: cc.stat,
        diff: cc.diff,
        committedAt: toDate(cc.committedAt),
        authorName: cc.authorName,
        createdAt: new Date(cc.createdAt)
      })
    }

    for (const it of rows<IntakeItemRow>('intake_items')) {
      await tx.insert(schema.intakeItems).values({
        id: createId('itk'),
        projectId: P[it.projectId]!,
        bodyMd: it.bodyMd,
        status: it.status,
        plannedCardKeys: it.plannedCardKeys,
        createdAt: new Date(it.createdAt),
        updatedAt: new Date(it.updatedAt),
        archivedAt: toDate(it.archivedAt)
      })
    }

    return projectIds
  })
}
