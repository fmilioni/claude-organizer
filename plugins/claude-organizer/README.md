# claude-organizer (Claude Code plugin)

Five skills:

- **`claude-organizer`** — how to **operate** the board: orient at the start of a session, keep statuses honest, comment with signal (not noise), docs.
- **`plan`** — turn a **new demand** into sprints/histories/tasks. Triggers automatically when you describe something to build.
- **`implement`** — **execute** a card that already exists, through a mandatory lifecycle (`in_progress` → read comments → implement → review → commit → done). Triggers when you start building a specific card.
- **`review`** — the **mandatory review gate** before work closes (per-task and story-level), run by a fresh subagent: checks acceptance criteria and hunts for reuse/dead-code/comment improvements. Fired by `implement` at task/story completion.
- **`autopilot`** — **run the board autonomously**: advance through several ready cards as independent PRs off `main` (trunk-based, no stacked PRs), guided by the blocker graph. Settles each ready card's decisions up front, asks sequential vs. parallel (worktrees), and stops when only PR-dependent/blocked work remains — never merging to `main` itself.

The shared "never assume — resolve open decisions" doctrine lives once in `shared/deciding.md`; `plan`, `implement` and `autopilot` reference it.

## Installation

Development (current session):

```bash
claude --plugin-dir plugins/claude-organizer
```

Distribution (marketplace, from this repo):

```
/plugin marketplace add <owner>/<repo>
/plugin install claude-organizer@claude-organizer
```

> **There is no `--plugin` flag.** Use `--plugin-dir` (dev) or the marketplace (distribution).

Installing the plugin registers the `claude-organizer` MCP automatically (bundled `.mcp.json`, HTTP transport) — the `mcp__claude-organizer__*` tools appear with no `claude mcp add`. If you enable it mid-session, run `/reload-plugins`.

## The MCP server

The plugin ships the skills **and** registers an MCP client pointing at an HTTP URL — but the MCP **server** must be running somewhere:

- **Local**: run the stack (Postgres + the MCP over Streamable HTTP) from this monorepo via Docker. Default URL `http://localhost:4402/mcp`; open when auth is off.
- **Remote / VPS**: point the plugin at your host by exporting `CO_MCP_URL` (e.g. `https://mcp.example.com/mcp`). When auth is on, `/mcp` is an OAuth 2.1 resource server and the plugin runs the OAuth flow itself — no token to paste.

```bash
CO_MCP_URL=https://mcp.example.com/mcp claude
```

`CO_MCP_URL` defaults safely: unset, the plugin talks to `http://localhost:4402/mcp`. See the root `README.md` for the full local/remote setup.
