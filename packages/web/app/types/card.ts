import type { CardStatus } from '@claude-organizer/shared'

export type {
  Card,
  CardClaim,
  CardParent,
  CardStatus,
  CardSubtask
} from '@claude-organizer/shared'

// Board columns, in order. `backlog` is intentionally absent: backlog cards
// live on the Tasks page, not in a board column.
export const cardStatusOrder: CardStatus[] = [
  'todo',
  'in_progress',
  'review',
  'done',
  'blocked'
]

// All statuses for status selectors (card detail, etc.), including `backlog`.
export const cardStatusSelectOrder: CardStatus[] = ['backlog', ...cardStatusOrder]

export const cardStatusMeta: Record<
  CardStatus,
  { label: string, color: 'neutral' | 'info' | 'warning' | 'success' | 'error' }
> = {
  backlog: { label: 'Backlog', color: 'neutral' },
  todo: { label: 'To do', color: 'neutral' },
  in_progress: { label: 'In progress', color: 'info' },
  review: { label: 'Review', color: 'warning' },
  done: { label: 'Done', color: 'success' },
  blocked: { label: 'Blocked', color: 'error' }
}
