import type { ComputedRef, InjectionKey } from 'vue'

/**
 * sprintId → sprint name for the cards on screen, provided by the multi-active
 * board so every `CardTile` can badge which active sprint it belongs to without
 * threading the map through the column/list components. Only the main board
 * provides it; the sprint detail (single sprint) leaves it unset, so tiles there
 * show no redundant badge.
 */
export const boardSprintNamesKey: InjectionKey<ComputedRef<Record<string, string>>>
  = Symbol('boardSprintNames')
