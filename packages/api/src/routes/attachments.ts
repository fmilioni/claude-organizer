import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import sharp from 'sharp'
import { z } from 'zod'

import {
  createAttachment,
  deleteAttachment,
  getAttachment,
  getAttachmentMeta,
  getSystemSettings,
  InputError,
  resolveCommitTokenSecret,
  setAttachmentOwner,
  signAttachmentToken
} from '@claude-organizer/core'
import type { Database } from '@claude-organizer/db'
import { ATTACHMENT_MIME_TYPES, ATTACHMENT_OWNER_TYPES } from '@claude-organizer/shared'

// Accept ceiling before optimization; the route's multipart fileSize limit
// mirrors the elevated bodyLimit the backup import uses.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
// Above this the model gains nothing from the extra pixels and the bytes just
// pile up; the longest edge is clamped here.
const MAX_EDGE = 1568
const WEBP_QUALITY = 80

const uploadQuery = z.object({ projectId: z.string().min(1) })
const ownerTypeSchema = z.enum(ATTACHMENT_OWNER_TYPES)

interface ParsedUpload {
  file?: { mime: string, filename: string | null, data: Buffer }
  fields: Record<string, string>
}

// Stream the multipart body once, in part order, so field/file ordering doesn't
// matter; keep only the first file and drain any extras.
async function readUpload(req: FastifyRequest): Promise<ParsedUpload> {
  const fields: Record<string, string> = {}
  let file: ParsedUpload['file']
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const data = await part.toBuffer()
      if (!file) file = { mime: part.mimetype, filename: part.filename ?? null, data }
    } else {
      fields[part.fieldname] = String(part.value)
    }
  }
  return { file, fields }
}

async function optimize(input: Buffer, mime: string) {
  // Animated GIFs keep their frames as an animated WebP; everything else is a
  // single frame. `.rotate()` bakes EXIF orientation in before sharp drops all
  // metadata (the default — no `.withMetadata()`), so the image stays upright
  // without leaking EXIF.
  const pipeline = sharp(input, { animated: mime === 'image/gif', failOn: 'none' })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

function serveAttachment(reply: FastifyReply, mime: string, data: Buffer) {
  reply.header('Content-Type', mime)
  // Bytes for an id never change (the entity is immutable); a private cache is
  // safe even under auth since the id is unguessable.
  reply.header('Cache-Control', 'private, max-age=300')
  return reply.send(data)
}

export function registerAttachmentRoutes(app: FastifyInstance, db: Database) {
  app.post<{ Querystring: { projectId?: string } }>(
    '/attachments',
    async (req) => {
      const { projectId } = uploadQuery.parse(req.query)

      let upload: ParsedUpload
      try {
        upload = await readUpload(req)
      } catch (err) {
        const code = (err as { code?: string }).code
        if (code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new InputError('Image exceeds the 10 MB upload limit')
        }
        // Any other `FST_*` (wrong content-type, too many parts/files…) is a
        // malformed request from the client → 400, not a server fault.
        if (typeof code === 'string' && code.startsWith('FST_')) {
          throw new InputError((err as Error).message)
        }
        throw err
      }

      const file = upload.file
      if (!file) throw new InputError('No image file in the upload')
      if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.mime)) {
        throw new InputError(
          `Unsupported image type "${file.mime}". Allowed: ${ATTACHMENT_MIME_TYPES.join(', ')}.`
        )
      }

      let optimized
      try {
        optimized = await optimize(file.data, file.mime)
      } catch {
        throw new InputError('The file is not a valid image or could not be processed')
      }
      const { data, width, height } = optimized

      // Owner is all-or-nothing: a type without an id is a malformed payload, so
      // surface it as a clear 400 instead of a raw core ZodError on `ownerId`.
      let owner: { ownerType: (typeof ATTACHMENT_OWNER_TYPES)[number], ownerId: string } | undefined
      if (upload.fields.ownerType) {
        if (!upload.fields.ownerId) {
          throw new InputError('ownerId is required when ownerType is set')
        }
        owner = {
          ownerType: ownerTypeSchema.parse(upload.fields.ownerType),
          ownerId: upload.fields.ownerId
        }
      }

      const row = await createAttachment(db, {
        projectId,
        mime: 'image/webp',
        data: new Uint8Array(data),
        width,
        height,
        filename: file.filename,
        description: upload.fields.description ?? null,
        owner
      })

      return {
        id: row.id,
        url: `/attachments/${row.id}`,
        width: row.width,
        height: row.height,
        mime: row.mime
      }
    }
  )

  // Serve bytes. The auth gate (auth-enforcement) already let this through via a
  // session or a valid `?sig` attachment token, so the handler just streams.
  app.get<{ Params: { id: string } }>('/attachments/:id', async (req, reply) => {
    const row = await getAttachment(db, req.params.id)
    if (!row || !row.data) return reply.code(404).send({ error: 'not_found' })
    return serveAttachment(reply, row.mime, row.data)
  })

  // Mint a short-lived signed URL the web can drop into `<img src>`; the stored
  // markdown only ever holds the tokenless `/attachments/:id` path.
  app.get<{ Params: { id: string } }>('/attachments/:id/url', async (req, reply) => {
    const id = req.params.id
    if (!(await getAttachmentMeta(db, id))) {
      return reply.code(404).send({ error: 'not_found' })
    }
    const { authEnabled } = await getSystemSettings(db)
    const secret = authEnabled ? resolveCommitTokenSecret() : null
    if (!secret) return { url: `/attachments/${id}`, expiresAt: null }
    const signed = signAttachmentToken(id, secret)
    return { url: `/attachments/${id}?sig=${signed.token}`, expiresAt: signed.expiresAt }
  })

  // Bind an unowned (tmp) attachment to its entity once it exists (new comment /
  // inbox composer uploads before it has an id).
  app.patch<{ Params: { id: string }, Body: unknown }>(
    '/attachments/:id',
    async (req, reply) => {
      const owner = z
        .object({ ownerType: ownerTypeSchema, ownerId: z.string().min(1) })
        .parse(req.body)
      const row = await setAttachmentOwner(db, req.params.id, owner)
      if (!row) return reply.code(404).send({ error: 'not_found' })
      return { id: row.id, ownerType: row.ownerType, ownerId: row.ownerId }
    }
  )

  app.delete<{ Params: { id: string } }>('/attachments/:id', async (req, reply) => {
    const row = await deleteAttachment(db, req.params.id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return { deleted: true }
  })
}
