<div align="center">

# Claude Organizer

### A "Jira" for Claude Code — your agent's project board, exposed over MCP.

Claude Organizer gives Claude Code a real project-management system — cards,
sprints, roadmaps, comments and docs — as **queryable state over MCP**, instead
of spec Markdown files that grow without bound and go stale. A clean Nuxt UI
mirrors the same board for humans, in real time.

It ships as a **Claude Code plugin** (five skills + the MCP server), backed by a
pnpm monorepo you run with Docker.

<br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520.10-43853d)
![pnpm](https://img.shields.io/badge/pnpm-9-f69220)
![Docker](https://img.shields.io/badge/Docker-compose-2496ed)
![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-8a63d2)

<br/>

<img src="docs/screenshots/board.png" alt="Claude Organizer board — a sprint with cards across To do / In progress / Review / Done" width="100%"/>

</div>

---

## Why

A long-running coding agent has no memory between sessions. The usual fix —
piling plans and decisions into ever-growing `.md` files — rots fast: the files
drift from reality, contradict each other, and bloat the context window.

Claude Organizer flips that. **What** to do (the active sprint, cards, backlog,
comments, decisions, docs) lives in a database the AI queries on demand through
MCP tools, and edits as work progresses. The agent orients itself at the start
of every session by reading the board — not by re-reading stale prose. You watch
the same board, drag cards, and leave comments the agent reads back.

## Highlights

- 🗂️ **A real board** — projects, sprints, stories and sub-tasks, blockers,
  tags, priorities. Drag-and-drop UI with live WebSocket updates.
- 🤖 **Built for the agent** — every entity is a typed MCP tool; prefixed IDs
  (`prj_`, `crd_`, `spr_`…) tell the AI what it's holding at a glance.
- 💬 **Comments as the decision log** — the agent records *why* it did something
  on the card; you reply, it reads your unread comments back next session.
- 🔗 **Commits attached to cards** — each card keeps the diff that delivered it,
  captured outside the AI's context (no tokens spent reading patches).
- 📚 **Docs that don't rot** — architecture, ADRs and patterns live as project
  docs the agent reads before reinventing.
- 🔐 **Auth when you want it** — runs open by default, or turn on sign-in
  (email+password, GitHub optional) with roles and per-project access.
- 🔌 **One-command install** — the plugin delivers the skills *and* registers the
  MCP; no `claude mcp add`.

<div align="center">
<table>
<tr>
<td width="50%"><img src="docs/screenshots/card-detail.png" alt="Card detail — description, acceptance criteria, status, sprint, tags and attached commit"/></td>
<td width="50%"><img src="docs/screenshots/card-comments.png" alt="Card comments and attached commit diff, with an unread-by-AI comment from the human"/></td>
</tr>
<tr>
<td align="center"><sub>Card detail — description, acceptance criteria, status & the attached commit.</sub></td>
<td align="center"><sub>The commit diff plus the comment thread — the agent's decision log.</sub></td>
</tr>
</table>
</div>

## Quick start

> **Requires** Node 20.10+, pnpm 9+, and Docker.

### 1. Bring up the stack

Postgres + migrations + API + UI + MCP, in one shot:

```bash
git clone https://github.com/fmilioni/claude-organizer.git
cd claude-organizer
cp .env.example .env
docker compose up -d --build
```

| Service | URL |
| --- | --- |
| **Web UI** | http://localhost:4401 |
| **API** | http://localhost:4400 |
| **MCP** (Streamable HTTP) | http://localhost:4402/mcp |

Migrations run automatically before the API and MCP start. Postgres data persists
under `./docker/data/postgres`. Out of the box the board is **open** (no login) —
see [Run modes](#run-modes) to turn auth on or to go remote.

### 2. Configure the environment

`cp .env.example .env` already gives you working defaults for local Docker. The
values worth knowing:

```bash
# Postgres
POSTGRES_USER=organizer
POSTGRES_PASSWORD=organizer
POSTGRES_DB=organizer
POSTGRES_PORT=5544                 # host port (in-container is 5432)

# API & Web
API_PORT=4400
NUXT_PUBLIC_API_URL=http://127.0.0.1:4400

# MCP transport (Streamable HTTP at /mcp)
# MCP_HTTP_PORT=4402               # override the port (default 4402)
# MCP_PUBLIC_URL=http://127.0.0.1:4402   # public URL clients reach the MCP at
```

The MCP is served over **Streamable HTTP** at `/mcp` — that's the transport the
plugin connects to. Auth is **off by default** (open board, like before it
landed); turn it on from the in-app setup — see [Authentication](#authentication).

### 3. Install the plugin

The plugin delivers the **skills** *and* registers the **MCP** — no
`claude mcp add` needed.

From a clone:

```bash
claude --plugin-dir plugins/claude-organizer
```

Or via the marketplace:

```text
/plugin marketplace add fmilioni/claude-organizer
/plugin install claude-organizer@claude-organizer
```

The `claude-organizer` tools appear automatically, pointing at
`${CO_MCP_URL:-http://localhost:4402/mcp}`. To reach a remote host, export
`CO_MCP_URL` (see [Run modes](#run-modes)); when auth is on, the plugin runs the
OAuth flow itself — there's no token to paste.

## Run modes

The same stack runs three ways. The only differences are a couple of env vars and,
for remote, the reverse-proxy overlay.

### Local, no auth (default)

`docker compose up -d --build` and you're done: an open board on
`http://localhost:4401` and an open MCP on `http://localhost:4402/mcp`. No login,
no token — the plugin connects as-is. This matches how the project ran before auth
existed.

### Local, with auth

Turn auth on from the **first-boot setup** on the login screen — the first account
becomes the **admin**; after that, sign-in is required. Accounts use
email+password by default, with **GitHub OAuth optional** (set `GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET`). Set a `BETTER_AUTH_SECRET` in `.env` for anything beyond a
throwaway local run. The MCP then requires OAuth — the plugin performs the flow for
you, so `CO_MCP_URL` is still all you set. Details in [Authentication](#authentication).

### Remote (reverse proxy + subdomains)

For a hosted deployment, put the three services behind a single TLS edge on
**80/443** with **Caddy**, routing one subdomain each. A versioned overlay does this:

```bash
cp .env.prod.example .env   # set *_DOMAIN, ACME_EMAIL, BETTER_AUTH_SECRET, public URLs
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

- `app.<domain>` → web, `api.<domain>` → API, `mcp.<domain>` → MCP. Point DNS for
  all three at the host; Caddy issues and renews TLS automatically (ACME).
- Only Caddy publishes host ports; postgres/api/web/mcp stay on the internal
  network. The reverse-proxy config lives in [`deploy/Caddyfile`](deploy/Caddyfile).
- **Point the plugin at the remote MCP** by its subdomain:

  ```bash
  CO_MCP_URL=https://mcp.<domain>/mcp claude
  ```

- `AUTH_COOKIE_DOMAIN=<domain>` shares the session cookie across `app.`/`api.`, and
  `NUXT_PUBLIC_API_URL` is **baked into the SPA at build time** (`ssr: false`), so
  set it to `https://api.<domain>` before `up --build`. All values are in
  [`.env.prod.example`](.env.prod.example).

## Authentication

Auth is built on [better-auth](https://better-auth.com) and is **off by default**
(the open board above). When on:

- **Methods** — email+password is the zero-config base; **GitHub OAuth** is
  optional and only appears when `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` are
  set (callback `https://api.<domain>/api/auth/callback/github`). No host is forced
  to register an OAuth app.
- **First boot** — the first account to sign in claims **admin**; from there,
  users get **roles** and **per-project access**, and admins manage who can see
  what.
- **MCP** — with auth on, `/mcp` is an OAuth 2.1 resource server: the plugin
  obtains a bearer automatically. With auth off, `/mcp` is open (no login),
  mirroring the open board.
- **Sem-auth mode** — the default; flip it from the setup screen or system
  settings.

Relevant env (see `.env.example`):

| Var | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signs sessions/tokens — **required in production**. |
| `BETTER_AUTH_URL` | Public URL of the API (where better-auth is mounted). |
| `AUTH_TRUSTED_ORIGINS` | Origins allowed to call auth (CSRF) — also the API's CORS allow-list. |
| `AUTH_COOKIE_DOMAIN` | Parent domain to share the session cookie across subdomains (remote only). |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Enable GitHub sign-in. |

> **Local gotcha:** the web (`:4401`) and API (`:4400`) are different origins, and
> the session cookie is `SameSite=Lax` + host-bound. Locally, reach **both on the
> same host** — use `127.0.0.1`, not `localhost` — or the cookie won't be sent.
> Behind the reverse proxy, `AUTH_COOKIE_DOMAIN` removes this constraint across the
> subdomains.

## The skills

Five skills drive the work — you don't call them by hand, they trigger from what
you say:

| Skill | What it does | Triggers when… |
| --- | --- | --- |
| **`claude-organizer`** | Orient & operate the board: read the active sprint, unread comments, keep statuses honest, write docs. | the start of any session — *"let's continue", "what's next?"* |
| **`plan`** | Turn a fuzzy new demand into structured work (sprint → stories → tasks), gets the design approved, then creates the cards. | you describe something new to build, before it's broken down. |
| **`implement`** | Execute one existing card through its lifecycle: `in_progress` → read comments → implement → review → commit → `done`. | you start/resume work on a specific card — *"work CO-42", "build it"*. |
| **`review`** | A mandatory review gate (per-task + story-level), run by a fresh subagent: checks acceptance criteria, hunts bugs/security/reuse. | a task or story's last task just finished (fired by `implement`). |
| **`autopilot`** | Run the board autonomously — advance through several ready cards as **independent PRs off `main`**, guided by the blocker graph. Never merges; your merge is the gate. | you ask it to run the board on its own. |

## Using it

Just talk to Claude Code.

**Plan a new demand** — the `plan` skill:

> **You:** I want to add CSV export to the board — a button that downloads the
> active sprint's cards.
>
> **Claude:** *asks a couple of questions, proposes a breakdown into a sprint +
> tasks, and on your OK creates the cards.*

**Continue later** — the `claude-organizer` + `implement` skills. A fresh session
has no memory, so it reads the board before touching code:

> **You:** let's continue — what's next?
>
> **Claude:** *reads the active sprint, your unread comments and the in-flight
> cards, picks the top one, moves it to `in_progress`, implements it, records the
> decisions as comments, runs the review gate, then moves it to `review` for you.*

**Let it run** — the `autopilot` skill works several ready cards as separate PRs
and stops when only blocked/PR-dependent work remains. Your merge confirms each.

### Inbox

Got an idea mid-flight but don't want to plan it yet? Drop it in the **inbox** — a
one-line demand captured without breaking it into cards. The agent reads pending
inbox items when it orients and offers to plan them; the `plan` skill turns a
demand into the right sprint/stories/tasks and marks it planned. It keeps raw
intake out of the board until it's actually structured work.

## Architecture

```text
Claude Code ──HTTP──▶ MCP (:4402/mcp) ─┐
                                       ├─▶ core ──▶ Postgres 16
Browser (SPA) ──HTTP──▶ API (:4400) ───┘   (+ WebSocket /ws for real-time)
```

A pnpm monorepo under `packages/`:

| Package | Role |
| --- | --- |
| `shared` | Shared TypeScript types. |
| `db` | Drizzle schema + migrations. |
| `core` | Zod-validated use-cases — the single source of truth. |
| `auth` | better-auth setup (email+password, GitHub, OAuth for the MCP). |
| `mcp` | The MCP server (Streamable HTTP). |
| `api` | Fastify REST + WebSocket. |
| `web` | Nuxt 4 SPA (the UI talks only to the API, never the MCP). |

Prefixed nanoid IDs (`prj_`, `crd_`, `spr_`…) let the agent recognize an entity's
type from the ID alone.

## Development (without Docker)

```bash
pnpm install
pnpm db:up                       # Postgres on :5544
pnpm db:migrate
pnpm dev:api                     # :4400
pnpm dev:web                     # :4401
pnpm dev:mcp                     # :4402/mcp
```

Also handy: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm db:generate`
after schema changes.

## Roadmap

Authentication has landed — sign-in (email+password, GitHub optional), roles and
per-project access, OAuth for the MCP, and identity on comments. What's still open:

- 🏢 **Multi-tenant workspaces** — isolated organizations, each with its own
  projects, members and MCP credentials.
- 🔑 **Per-agent MCP tokens** — scoped credentials per agent, beyond the current
  per-user project scope.
- 📦 **Import / export** — move a board between instances via a portable backup
  of projects, sprints, cards, comments and docs.

## License

[MIT](LICENSE) © Felipe Milioni
