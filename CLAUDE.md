# Claude Organizer

"Jira for Claude Code": project management exposed over MCP. The AI uses the
system to organize its own development (auto-inception). **International** product.

## Skills

Four skills drive the work (packaged in `plugins/claude-organizer`):

- **`claude-organizer`** — how to operate the board: orient at the start of a
  session, keep statuses honest, comment with signal, docs.
- **`plan`** — turn a new demand into sprints/histories/tasks (auto-triggers
  when you describe something to build).
- **`implement`** — execute a card that already exists, through a mandatory
  lifecycle (in_progress → read comments → implement → review → commit → done).
  Auto-triggers when you start building a specific card.
- **`review`** — mandatory review gate before work closes (per-task + story-level),
  run by a fresh subagent: checks acceptance criteria and hunts for reuse/dead-code/
  comment improvements. Fired by `implement` at task/story completion.

The "never assume — resolve open decisions" doctrine is carried **inline** in
each skill that uses it (`plan` and `implement`), so each skill is
self-contained.

Let the skills drive. **What** to do (active sprint, cards, backlog, comments,
docs) is the source of truth and lives **in the MCP**, not here — query it via
`mcp__claude-organizer__*`. Don't duplicate state into this file.

This project in the MCP:

- **slug**: `claude-organizer`
- **keyPrefix**: `CO` (cards are `CO-1`, `CO-2`…)
- **projectId**: `prj_zrvn6leze9r3`

## Knowledge lives in the docs, not here

Architecture, data model, decisions (ADRs), code/UI patterns and per-module
details live in the project's **docs** (`list_docs` / `read_doc`, grouped under
Modules / Decisions / Guides / Notes). Read there before reinventing or
re-deciding. Keep this file lean — it holds only the project-wide rules and
overrides below, and points to the docs for the rest.

## Project rules (overrides)

- **Language**: write **skills and code in English** (the product is
  international). Content authored for the user — **tasks, comments and docs** —
  follows the user's language.
- **Commits**: one commit per card/task, **only after the user confirms** it
  works; the message is written **in English** and references the key (e.g.
  `feat(tags): … (CO-4)`). After committing, attach its diff to the card with
  `pnpm attach-commit <sha>` (captured outside the AI context — never read or
  paste the diff).
- **PRs**: written **in English** (title *and* body, same as commits — only
  tasks/comments/docs follow the user's language). Write the **title as a
  conventional-commit** (`feat(scope): … (CO-N)`); PRs are **squash-merged**, so
  the title becomes the commit message. The body summarizes the work — **no
  "Generated with Claude Code" footer**.
  - **Merging is the user's call.** By default the AI opens the PR and **stops**;
    the user merges. `main` is **branch-protected**, so a plain `gh pr merge`
    fails — and the AI must **not** reach for `--admin` on its own initiative
    (that bypasses the protection). Only when the user **explicitly tells the AI
    to merge** does it run `gh pr merge <n> --squash --admin --delete-branch`
    (the owner override the protection requires), and that approval is **per
    merge**, never standing.
- **Auth (diff capture)**: auth is **ON** in this deployment — the
  `attach-commit` / `attach-worktree-diff` scripts need a card-scoped token. Mint
  `issue_commit_token(<CO-N>)` and pass it as `CO_COMMIT_TOKEN=<token> pnpm
  attach-… <arg>` (one token per attach).
  - **Run from the repo root.** `attach-commit` / `attach-worktree-diff` are
    **root** `package.json` scripts. If the shell's cwd drifted into a package
    (e.g. a prior `cd packages/core`), `pnpm attach-…` fails with *"Command not
    found"* (pnpm looks in that package) and the bundled `node …/scripts/*.mjs`
    path breaks too (it's relative to root). So `cd` back to the repo root first,
    or prefix the command with the absolute root path — then run
    `CO_COMMIT_TOKEN=<token> pnpm attach-commit <sha>` /
    `pnpm attach-worktree-diff <CO-N>`.
- **Versioning**: every version (each `package.json`, the plugin manifests and
  the MCP server) stays in sync — to set it, run `pnpm bump <version>` (the
  unified bump script); never edit version fields by hand.
- **Gotchas** (detailed in the docs): consult the `nuxt-ui-remote` MCP before
  using a new Nuxt UI component; relative TS imports have **no `.js`** extension;
  markdown via `<AppMarkdown>` (never `@nuxtjs/mdc`).

## Day to day

To test a **new version of api / web / mcp**, rebuild and restart them in Docker —
preferred, since it mirrors how they actually run (notably the MCP over HTTP, the
same transport the plugin connects to):

```bash
docker compose up -d --build   # rebuild + restart api(4400) web(4401) mcp(4402)
```

`pnpm dev:*` still works for fast local iteration:

```bash
pnpm db:up        # Postgres (after reboot)
pnpm dev:api      # http://127.0.0.1:4400
pnpm dev:web      # http://127.0.0.1:4401
pnpm typecheck    # all packages (root -r)
pnpm lint         # all packages (root -r)
pnpm db:generate  # after schema changes
pnpm db:migrate   # apply
```

Always run `pnpm typecheck` **and** `pnpm lint` from the **repo root** (the `-r`
scripts hit every package) before closing a card — never scope them to a single
package. A story routinely edits more than one package, and a per-package check
silently goes stale the moment another package is touched.

## After restarting Claude Code

The `claude-organizer` MCP loads automatically (user scope); Postgres must be UP.
If a new MCP tool doesn't show up, the process started with the old code — restart
Claude Code again.
