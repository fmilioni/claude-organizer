// Bump whenever the envelope shape or a table's serialized form changes; the
// importer (CO-142) migrates an old backup's `version` up to this one.
export const BACKUP_FORMAT_VERSION = 2

export type BackupScope = 'project' | 'all'

// `data` maps each SQL table name to its raw rows, dates as ISO strings (wire form).
export interface BackupEnvelope {
  version: number
  exportedAt: string
  scope: BackupScope
  projectIds: string[]
  data: Record<string, unknown[]>
}
