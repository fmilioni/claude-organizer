// Single source of truth for markdown typography, shared by the rendered preview
// (AppMarkdown) and the markdown editor (MarkdownEditor/UEditor), so a field looks
// identical whether it's being read or edited. Auto-imported by Nuxt as `PROSE`.
//
// Most rules mirror the UEditor theme (.nuxt/ui/editor.ts) — the editor is the
// source of truth — so the preview (which has no editor theme) reproduces it.
// The `!` SUFFIX (Tailwind 4) forces a rule past the UEditor theme inside the
// editor's merged base; in the preview there's no theme, so it's a harmless no-op.
// It's load-bearing where tailwind-merge won't fold the conflict — notably the
// editor's `px-3!` vs the theme's different-variant `sm:px-8` (in MarkdownEditor).
export const PROSE = [
  'text-sm leading-relaxed',
  '[&_*:first-child]:mt-0! [&_*:last-child]:mb-0!',
  '[&_:is(h1,h2,h3)]:text-highlighted',
  '[&_h1]:text-base! [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1',
  '[&_h2]:text-sm! [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1',
  '[&_h3]:text-sm! [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1',
  '[&_p]:my-1.5 [&_p]:leading-relaxed!',
  '[&_a]:text-primary [&_a]:font-medium [&_a]:border-b [&_a]:border-transparent hover:[&_a]:border-primary [&_a]:transition-colors',
  '[&_strong]:font-semibold',
  '[&_blockquote]:my-3 [&_blockquote]:border-s-4 [&_blockquote]:border-accented [&_blockquote]:ps-4 [&_blockquote]:italic',
  '[&_hr]:my-4 [&_hr]:border-t [&_hr]:border-default',
  '[&_ul]:list-disc [&_ul]:marker:text-(--ui-border-accented)',
  '[&_ol]:list-decimal [&_ol]:marker:text-muted',
  '[&_:is(ul,ol)]:my-1.5 [&_:is(ul,ol)]:ps-6',
  '[&_li]:my-0.5! [&_li]:ps-1.5',
  '[&_pre]:my-3 [&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-2! [&_pre]:border-0! [&_pre]:text-sm [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:overflow-x-auto',
  '[&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:text-inherit [&_pre_code]:font-mono [&_pre_code]:inline',
  '[&_code]:bg-muted [&_code]:border-0! [&_code]:text-highlighted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-sm [&_code]:font-mono [&_code]:font-medium [&_code]:inline-block',
  // Block + auto inline-margin: an image narrower than the container centers; a
  // full-width one stays put. Mirrors the editor theme so preview and editor match.
  '[&_img]:block [&_img]:max-w-full [&_img]:rounded-md [&_img]:mx-auto'
].join(' ')
