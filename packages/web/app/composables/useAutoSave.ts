import { reactive, type Ref, ref, watch } from 'vue'

/**
 * How an editable string field maps onto the PATCH body:
 * - `required`: send the trimmed value only when it's non-empty and changed
 *   (never clears the field). E.g. a card title or sprint name.
 * - `nullable`: send the value, or `null` when blank. E.g. a summary/goal.
 * - `raw`: send the value as typed, blank included. E.g. a markdown body.
 */
type FieldMode = 'required' | 'nullable' | 'raw'

type FieldSpec<K extends string> = K | { key: K, mode?: FieldMode }

interface UseAutoSaveOptions<T, K extends string> {
  /** REST collection the entity lives in: `/{resource}/{id}` is the PATCH target. */
  resource: string
  /** Editable fields and how each maps to the body. A bare string defaults to `raw`. */
  fields: ReadonlyArray<FieldSpec<K>>
  /**
   * Called with the persisted entity after each save. The consumer is expected
   * to swap it back into `entity` (merge or replace) so the diff baseline — and
   * any list/parent view — advances; otherwise the next edit re-detects the
   * same change.
   */
  onSaved?: (updated: T) => void
  /** Debounce before saving after the last keystroke (default 800ms). */
  debounceMs?: number
  /** How long the "Saved" indicator stays on (default 1500ms). */
  savedMs?: number
}

const display = (value: unknown): string => (value == null ? '' : String(value))

/**
 * Debounced inline auto-save for an entity's editable fields, with a "saving/
 * saved" indicator and a smart-sync that keeps the editable buffer in step with
 * the entity without ever clobbering a field the user is mid-editing (a realtime
 * echo of our own save, or another tab's edit). See ADR "Auto-save with debounce
 * + refresh silent". Used by card detail, docs and sprint inline editing.
 *
 * `save(body)` is also exposed for one-off field updates (status, priority, …)
 * that share the same indicator and persistence.
 */
export function useAutoSave<T extends { id: string }, K extends string>(
  entity: Ref<T | null | undefined>,
  options: UseAutoSaveOptions<T, K>
) {
  const api = useApi()
  const debounceMs = options.debounceMs ?? 800
  const savedMs = options.savedMs ?? 1500

  const configs = options.fields.map(field =>
    typeof field === 'string'
      ? { key: field, mode: 'raw' as FieldMode }
      : { key: field.key, mode: field.mode ?? 'raw' }
  )

  const initial: Record<string, string> = {}
  for (const { key } of configs) initial[key] = ''
  const editing = reactive(initial)

  const saving = ref(false)
  const justSaved = ref(false)

  const read = (source: T | null | undefined, key: string) =>
    display((source as Record<string, unknown> | null | undefined)?.[key])

  // Smart-sync: a brand-new entity (or first load) resets the buffer; otherwise
  // each field only follows the entity while the user hasn't diverged locally.
  watch(
    entity,
    (fresh, prev) => {
      if (!fresh) return
      if (!prev || prev.id !== fresh.id) {
        for (const { key } of configs) editing[key] = read(fresh, key)
        return
      }
      for (const { key } of configs) {
        if (editing[key] === read(prev, key) && read(fresh, key) !== editing[key]) {
          editing[key] = read(fresh, key)
        }
      }
    },
    { immediate: true }
  )

  const { start: restartSavedIndicator } = useTimeoutFn(
    () => {
      justSaved.value = false
    },
    savedMs,
    { immediate: false }
  )

  async function save(body: Record<string, unknown>) {
    const target = entity.value
    if (!target) return
    saving.value = true
    try {
      const updated = await api<T>(`/${options.resource}/${target.id}`, {
        method: 'PATCH',
        body
      })
      options.onSaved?.(updated)
      justSaved.value = true
      restartSavedIndicator()
    } finally {
      saving.value = false
    }
  }

  function buildDirty(): Record<string, unknown> | null {
    const target = entity.value
    if (!target) return null
    const body: Record<string, unknown> = {}
    for (const { key, mode } of configs) {
      const value = editing[key]!
      const persisted = read(target, key)
      if (mode === 'required') {
        const trimmed = value.trim()
        if (trimmed && trimmed !== persisted) body[key] = trimmed
      } else if (value !== persisted) {
        body[key] = mode === 'nullable' ? (value.trim() ? value : null) : value
      }
    }
    return Object.keys(body).length > 0 ? body : null
  }

  function saveDirty() {
    const body = buildDirty()
    if (body) void save(body)
  }

  // A flush bumps the generation so a debounced call already queued (it can't be
  // cancelled — useDebounceFn exposes no cancel) resolves as a no-op instead of
  // firing a redundant save after the immediate one.
  let generation = 0
  const scheduleSave = useDebounceFn((gen: number) => {
    if (gen !== generation) return
    saveDirty()
  }, debounceMs)

  // Persist any pending edit immediately, skipping the debounce — for when the
  // editor is dismissed (blur/click-outside) before the timer fires. `save`
  // captures the entity synchronously, so the caller may detach it right after.
  function flush() {
    generation++
    saveDirty()
  }

  watch(() => configs.map(({ key }) => editing[key]), () => {
    void scheduleSave(generation)
  })

  return {
    editing: editing as Record<K, string>,
    saving,
    justSaved,
    save,
    flush
  }
}
