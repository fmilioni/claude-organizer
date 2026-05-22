# Claude Organizer

"Jira for Claude Code": project management exposed over MCP. The AI uses the
system to organize its own development (auto-inception). **International** product.

## Skills

Two skills drive the work (packaged in `plugins/claude-organizer`):

- **`claude-organizer`** — how to work the board: orient at the start of a session,
  work cards, comment with signal, docs.
- **`plan`** — turn a new demand into sprints/histories/tasks (auto-triggers
  when you describe something to build).

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
pnpm typecheck    # backend + web
pnpm db:generate  # after schema changes
pnpm db:migrate   # apply
```

## After restarting Claude Code

The `claude-organizer` MCP loads automatically (user scope); Postgres must be UP.
If a new MCP tool doesn't show up, the process started with the old code — restart
Claude Code again.
