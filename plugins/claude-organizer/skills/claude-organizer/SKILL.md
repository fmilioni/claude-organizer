---
name: claude-organizer
description: Use whenever the mcp__claude-organizer__* tools are available and you're starting or continuing work on a project tracked here — the entry point and panorama for the board. Consult it at the START of every coding session (before exploring code) to orient, and for how the board, comments and docs work. Trigger even on a bare "let's continue" or "what's next". It does NOT hold the workflow rules: a NEW fuzzy demand → the `plan` skill; executing a specific card → the `implement` skill. Read state from here; don't rely on memory.
---

# Using claude-organizer

claude-organizer is a "Jira for Claude Code" exposed over MCP. It holds a project's **cards** (tasks), **sprints**, **backlog**, **comments**, and **docs**. It is the **source of truth for what to work on and why** — not your memory, not assumptions. Whenever its tools are available, use them to orient yourself and to record what you do, so work survives across sessions.

A fresh session starts with no memory of past work. This system is how continuity is preserved: the active sprint says what matters now, cards carry the detail, comments carry the back-and-forth with the user, and docs carry the architecture and decisions. Read it first; keep it honest.

> **Four skills, one board.** This skill covers **operating** the board — orienting, reading state, keeping it honest, comments and docs. The other three own distinct phases, and each holds its own workflow rules: **switch to the skill instead of working from memory.**
>
> - **`plan`** — a **new demand** (a feature, a change, a fix) to turn into work: it understands the demand and organizes it into sprints/histories/tasks. Planning, not code. **Creating any card goes through here** — never call `create_card` ad-hoc from this context or mid-execution. A task that lives in an **external tracker** is also a new demand — it enters through `plan` to be re-mapped as card(s), not executed directly.
> - **`implement`** — **executing** a card that already exists (a task, a story, a sprint's cards): it owns the **mandatory execution lifecycle** (`in_progress` → read comments → implement → review → commit → done). The moment you start building a specific card, that skill drives.
> - **`review`** — the **mandatory review gate** `implement` fires before work closes: a per-task review and a story-level review, run by a **fresh subagent** that checks acceptance criteria and hunts for reuse/dead-code/comment issues.
>
> Use this skill to orient and to keep the board honest throughout.

## Start of every session — orient before touching code

Do this sequence _before_ exploring the codebase or making changes:

1. **`list_projects`** — find the project whose `slug` matches the repo you're working in, and grab its `projectId`. Every other tool takes an explicit `projectId`.
2. **`get_active_sprint(projectId)`** — what's being worked on right now.
3. **`list_unhandled_comments(projectId)`** — feedback you haven't acted on yet (`unread` + `read`); address it first, it's often a correction or a new priority (mechanics in _Comments_).
4. **`list_cards`** — the cards in flight. Read **what's on the board now**, not just the active sprint:
   - `list_cards(projectId, sprintId=<active sprint>)` — the active sprint's cards.
   - `list_cards(projectId, backlogOnly=true)` — sprint-less cards. Those in a board status (`todo`…`done`) are **standalone cards on the board**; those in the `backlog` status are the **backlog**.
   - **Focused filters compose** — `activeOnly` (everything but done/backlog), a `status` list, `tag`, and `limit`/`offset` paging — so you can pull exactly the slice you need (see _Reading the board efficiently_).

   The board = the active sprint's cards **plus** every sprint-less card in a board status, so a card you must work may belong to no sprint at all. Returns short summaries, so you can scan many quickly.

5. For one card's full detail: **`get_card(id)`** or **`get_card_by_key(key)`** (e.g. `ABC-12`).
6. For architecture, decisions, or how-tos: **`list_docs(projectId)`** + **`read_doc(id)`**, or **`search_docs`**. Projects document themselves here — read before reinventing or re-deciding something.
7. **`list_inbox(projectId)`** — the **inbox**: raw demands the user captured (defaults to `pending`) that aren't cards yet. Note how many are waiting; suggest planning them at the right moment — see _Inbox_.

If no project matches the current repo, ask the user before creating one.

**Wire the repo link once.** After step 1, if the project has no `repoWebUrl`, detect the current repo's remote so commit hashes link to the provider: read `git remote get-url origin` (fallback: the first of `git remote -v`), convert it to a web URL (`git@github.com:owner/repo.git` or `https://github.com/owner/repo.git` → `https://github.com/owner/repo`; GitLab the same, subgroups included), pick the `provider` by host (`github`/`gitlab`; skip a self-hosted host you can't classify), and save it with `set_project_repo(projectId, provider, repoWebUrl)`. Skip when it's already set or there's no git remote.

**Record the board binding so the next session finds it.** A fresh session only knows this repo has a board if a `CLAUDE.md`-family file says so. So whenever you orient and match a project to the repo, check whether the binding — `slug`, `keyPrefix`, `projectId`, and the auth (diff-capture) flag — is already recorded in the repo's `CLAUDE.md` or `CLAUDE.local.md`; if it isn't, **write it**. This is **not** only a first-link step: do it for **any** project whose binding is missing, in any session. The stanza teaches the next agent three things — a claude-organizer board exists, orient through the **`claude-organizer`** skill, and *which* project it is (the ids above). Mirror the binding shape this repo's own `CLAUDE.md` documents.

- **Which file — detect, and ask when it isn't obvious.** A solo/private repo with one owner → `CLAUDE.md` (committed, shared) is the natural home, and the default when you do write. A repo with **several people on different boards**, or an **open-source** repo (where committing *your* board id is wrong) → `CLAUDE.local.md` (gitignored — make sure it's in `.gitignore`), optionally leaving a board-agnostic pointer in the committed `CLAUDE.md`. Detect what you can from the repo; when it's genuinely ambiguous, **ask** the user which file rather than guessing.
- **Nested directories that don't know they're covered.** A directory can sit *inside* a tree the organizer already covers without knowing it — whether **one board** spans the whole ecosystem (sub-folders mapping to it, e.g. via a tag per sub-area) or **several boards** live across the tree. When a session opens in a folder with **no binding** but coverage exists **above** it (a parent `CLAUDE.md`-family, or a project that covers this tree), **point upward**: write the lower folder's `CLAUDE.md` to reference the parent binding (or the project + the matching tag/sub-area), so the agent there knows it's inside the organizer and which project/tag to use. Keep it general — detect coverage above, link upward; don't bake in a specific layout.

## Reading the board efficiently — narrow, not wide

The board grows; an unfiltered read burns context (a bare `list_cards` on a mature project has pushed a single session past 100k+ characters). Read the slice that matters, not the whole board:

- **Filter, don't dump.** Prefer a filtered `list_cards` (the focused filters above) over the broad listing — reach for the unfiltered panorama only when you genuinely need it.
- **Have a key? Go straight to it.** With a `CO-N` in hand, `get_card_by_key` (or `get_card` by id) instead of listing to find it; for a handful of known keys, `get_cards` fetches them in one call.
- **Searching the past?** `search_cards` (cards + comments) and `search_docs` match by **meaning** (hybrid lexical + embedding) — describe what you're after in natural language ("how auth tokens get refreshed"), synonyms/typos still hit, and it degrades to plain lexical when embeddings are down. Ranked, with a snippet; far better than scanning sprint by sprint.
- **Order of discovery — which tool answers which question:** architecture/decisions → `search_docs`; a prior card or its comments → `search_cards`; unhandled user feedback → `list_unhandled_comments` (session start). Pick the tool before you start listing.
- **Don't over-read.** `get_card` / `list_comments` only for the cards you'll actually touch — don't walk the whole board "just to be safe".

## Multiple hosts — one server per host, never mix

You may have **more than one** organizer host connected at once — e.g. a **local** board and a **company** one. Each host is a **separate MCP server**, with its **own tool prefix** (the primary board is the bundled plugin, `mcp__plugin_claude-organizer_claude-organizer__*`; an added host is `mcp__claude-organizer-second__*`, …) and its **own set of projects** — they never share data.

- **One server = one host = its own projects.** Run the orientation (step 1, `list_projects`) **on the right server** and pick the one whose project `slug` matches the repo you're in. The tool prefix already tells you which host a call hits.
- **Never mix hosts in a single operation.** Keep a card/sprint/doc/comment on the **same** server its project lives on — don't read from one host and write to another.
- **Unsure which host a repo belongs to? Ask** — a project from the wrong host is worse than a question.

Adding a second host is a one-time `claude mcp add` (distinct name + URL); the bundled plugin ships only the default entry. See the README.

## Inbox — suggest planning, don't nag

The inbox (`list_inbox`, pending) holds **raw demands** the user dropped without planning them — not cards yet. You **always do what the user asked first**; then, with judgment, suggest turning pending demands into cards via the **`plan`** skill:

- User asked to **implement / build / fix** something → do it; **at the end**, re-check the inbox **fresh** (see below) and, if demands are pending, offer once: _"want to plan the N pending inbox demand(s)?"_
- User is **planning** something → plan what they asked; at the end, offer to plan the rest.
- User is **lost / asks what to do / what's next / asks for board status / is idle** → suggest planning the pending demands **right away** (plan first — it's the most useful next move).
- **No pending demands → say nothing.** And don't re-offer every turn — suggest sparingly, not on a loop.

**Re-check fresh at the end of work — never the orientation snapshot.** The inbox you read while orienting (step 7) goes stale: the user routinely drops demands **during** a long piece of work. So at every natural **end-of-work boundary** — finishing a story, **before advancing to the next story/sprint**, and **before ending the session** — call **`list_inbox` (pending) again, fresh**, and judge against *that*, not the snapshot. When the fresh check surfaces pending demands not covered by what you just did, treat it as a **decision gate**: **ask** the user whether to review/plan them now, noting that pending demands may **reshape the upcoming stories** — don't only mention them in passing or skip ahead. The `implement` skill enforces this same fresh re-check at its story boundaries.

Converting a demand into cards (creating cards → `plan`) is the **`plan`** skill's job (it reads the inbox and marks each planned); here you only orient and suggest.

## Before you analyze or act — read the tasks first, code second

Whether you're **starting a single card** or **analyzing a group of them** (the backlog, a sprint, a set of tech-debt cards, "what's left to do?"), read what the board already knows _before_ you open the codebase: each card's full **description** (`get_card` / `get_card_by_key`) **and its comments** (`list_comments`), plus which **sprint** it sits in. `list_cards` returns only short summaries — never base an analysis on summaries alone.

Comments routinely carry the decisive context: a card may be flagged _"consolidated into CO-31 — don't execute in isolation"_, already resolved, deferred, or superseded by another card. Skipping the comments and jumping to the code produces redundant or wrong conclusions (e.g. recommending work that's already planned elsewhere).

The actual workflow rules for each phase live in those phase skills (the blockquote above), not here — switch to them instead of reconstructing the flow from memory. Everything below is about **operating** the board itself — comments, cards, docs — and applies across all phases.

## Comments — write signal, not noise

A comment exists to change what the **next reader** (a memoryless future session, or the user) knows. The criterion: **record what is NOT deducible from the card's state; omit what is.**

**Worth a comment (signal):**

- Decisions made and **why**.
- Scope changes — what entered/left and why.
- What was deferred or became another task, with the reference (e.g. `→ CO-2`); card keys auto-link. Write each key **in full** — `CO-53, CO-54`, never a shorthand range like `CO-53/54` (only the `CO-53` half becomes a link).
- What **differed** from what the card asked, or from the plan.
- Domain insights, edge cases, relevant fixes.

**Noise — don't write it:**

- The plan, before/while doing the work.
- Facts deducible from the card's state: "typecheck passed", "lint ok", "tests green", "moved to review". If a card reached review/done, the basics are assumed.
- Step-by-step narration or exhaustive lists of touched lines that don't change understanding.

Learn the _criterion_ (signal vs. noise; deducible vs. new) — don't follow a fixed blacklist. "typecheck passed" is just one example of the concept. This criterion applies to **every** comment you write — including the **test plan** the `implement` skill makes you post when a card goes to `review`.

**Comments carry a three-state AI read-status — `unread → read → handled`.** A user comment is born `unread` (the AI has never seen it); an AI comment is born `handled` (the AI's own words never count as pending). Two transitions move it forward:

- **`unread → read` is automatic when you read the card's thread via `list_comments(cardId)`** — reading over MCP **advances** that card's `unread` user comments to `read`. (It never demotes a `handled` comment and never promotes `read → handled`.) Opening the card in the **web** UI does **not** advance state — only the MCP read path does. So scanning a thread to find a past decision does mark its unread comments as `read`; that's intended — you *did* read them.
- **`→ handled` is explicit, via `mark_comments_handled([...commentIds])`** — call it only when you've **actually acted** on the comment (fixed the bug, planned it, folded the decision in), not merely read it. This is the step that takes a comment out of the unhandled queue for good.

The session-start scan **`list_unhandled_comments(projectId)`** returns everything not yet handled (`unread` + `read`), advancing what it returns `unread → read` the same way — so a comment read but not acted on resurfaces next session until you handle it. **When you pick a card up to develop, `list_comments(cardId)` is mandatory before implementing** — the `implement` skill enforces this (every card, every time, even if read before, because new context may have landed). Reading the history's comments does **not** cover its children.

**Author each paragraph or bullet as one continuous line — never hard-wrap (manual line breaks) mid-paragraph.** Soft-wrapping is the renderer's job, not the author's, and this holds for **every authored body alike — card/task descriptions, comments and docs**. Legitimate markdown structure stays: headings, one list item per line, table rows, fenced code blocks, and blank-line-separated paragraphs.

## Cards — field reference

**Creating cards → `plan`.** This section is **only** a field reference (so you understand the shape of a card and can keep existing ones honest with `update_card`, status moves, tags, blockers); it is **not** a licence to mint new cards directly.

- **`summary`** — one line (~100 chars) describing _what_ the card is about. It's what shows on the board and in `list_cards`. **Required on creation:** `create_card` rejects a missing/blank/whitespace-only summary, so every new card is born with one.
- **`descriptionMd`** — the spec: _behavior and intent_, acceptance criteria, decisions — **not** implementation code.
- **Sprint and status together decide where a card shows.** A card with **no `sprintId`** is sprint-less: in the **`backlog`** status it sits in the backlog; in a board status (`todo`…`done`) it's a **standalone card on the board**. A card in a sprint shows on the board while that sprint is active. New cards default to `backlog` when created with no sprint, `todo` when created in a sprint.
- **`parentId`** makes a card a sub-task of a **history** (one level). A card can be **blocked by** others (add/remove blockers) — the board flags it while a blocker isn't `done`.

**Always tag a task after creating it.** Attach the tag(s) that fit — area/layer (e.g. `web`, `api`, `mcp`) or type (e.g. `bug`). If no existing tag fits, **suggest new tag(s) and ask the user before creating them** — never invent tags silently. Tagged cards keep the board filterable and scannable.

## Archiving done cards — default to sprint-less, and always confirm

Archiving clears finished cards off the board; how you scope the batch depends on what the user actually said:

- **"archive the done cards"** (no sprint mentioned) ⇒ assume the **done cards with no sprint**: enumerate with `list_cards(projectId, status=["done"], backlogOnly=true)`. Rationale: archiving a sprint already takes its cards off the board, and archiving the done cards of an *archived* sprint is moot — so the natural default target is the **sprint-less** done.
- **"archive the done cards of sprint X"** (explicit) ⇒ only then use the sprint filter: that sprint's done cards.
- **Always confirm before archiving** — present the **count** and the **keys** (`CO-N`) you're about to archive, and wait for the OK. Never bulk-archive without it.

## Docs — read before building, record after deciding

Docs are organized into **four top-level groups**; put each new doc under the right one:

- **Modules** (`module`) — one doc per code area/feature: what it does, how it's used, what it depends on.
- **Decisions / ADRs** (`adr`) — **one decision per doc** (_Context · Decision · Consequences_, terse). Don't pile decisions into a single doc. **Don't prefix the title with "ADR:"** — the `kind` already marks it as a decision; title it by the decision itself (e.g. "Drizzle ORM over Prisma", not "ADR: Drizzle ORM over Prisma").
- **Guides** (`guide`) — how-tos and references.
- **Notes** (`note`) — loose context, pending items, observations.

**Consult the docs before creating or executing a task.** Scan the docs tree first and read what's relevant to the task's area — the `module` for the code you'll touch, an `adr` for a decision that affects it, a `note` that might carry a constraint. You don't need to read _everything_ (no need to read a back-end note for a front-end task), but you DO need to glance at the tree and decide what's worth opening. Important context often lives only in a doc.

Use **`write_doc`** (no `id` creates, `id` updates; pass `parentId` to nest under a group), **`search_docs`** to find, **`read_doc`** for full content.

### Reference a doc as a link — never a bare id

Whenever you **mention or reference a doc** — in a card's description, a comment, or another doc's body — write it as a markdown link **with the doc's title**: `[Doc title](/docs?doc=<id>)`, where `<id>` is the doc's `doc_…` id. This is the docs analog of the auto-linked `CO-N` key, but **explicit**, because a doc id is opaque — a reader can't tell what it points at without the title. The link needs **no code change**: it relies only on the web `/docs` page reading the `?doc=<id>` param to open that doc. So `[Drizzle ORM over Prisma](/docs?doc=doc_abc123)`, never a bare id or an untitled link.

### Record durable knowledge the moment it appears — without being asked

Writing a doc is a **default action, not a favor the user has to request**. Apply the same assertiveness as the signal-vs-noise rule for comments: the moment durable, non-deducible knowledge appears, **write or update the doc yourself** — don't wait to be told. Triggers (learn the criterion, not a fixed list):

- A **decision** with more than one defensible path was made (or reversed) → write an `adr` (Context · Decision · Consequences, terse) under Decisions. Capture the **why**.
- A **standardization / convention** emerged or changed — a code/UI pattern, a naming or structural rule → update the matching `guide`/`module`.
- **Long-lived knowledge** about a module/feature — how it works, what it depends on, a gotcha a future reader would trip on → the `module`/`note`.

Rules of thumb (only ask the user in a real doubt, e.g. creating a brand-new doc _group_):

- **Always set `summary` when creating a doc — it's required, not just recommended.** A new doc (`write_doc` with no `id`) must be born with a one-line `summary`: `write_doc` **rejects a missing/blank/whitespace-only summary on creation** (on **update** — with `id` — it stays optional, so a partial edit never has to resend it). It's what shows in `list_docs` and feeds search, so apply the same signal-vs-noise criterion as a comment: say what the doc is about in one tight line, no noise.
- **Update > duplicate.** If a doc for the area already exists, edit it (pass its `id`) — don't create a second one that drifts.
- **Retire a `note` when its issue is resolved — don't mark it "resolved".** A `note` capturing a pending item / gap is **transient**: once the work lands, move whatever durable knowledge it holds into the right `module`/`adr` (the permanent home) and then **delete or archive the note**. Leaving a note that says "resolved" is doc spam — a future reader has to open it to learn it no longer matters. If nothing durable survives, just delete it.

## Image attachments — describe for search, embed by reference, open on demand

Images pasted or dropped into a card, comment, doc or inbox item are stored as **attachments** and surfaced two ways: the read payloads (`get_card`, `list_comments`, `read_doc`, `list_inbox`) carry an **`attachments` array** (`{ id, uri, mime, width, height, description }`), and each image is an **MCP resource** at `attachment://<id>`.

- **Open the image whenever it carries meaning you need.** The agent isn't a browser — a markdown `![](…)` link is not "seen". To understand or implement anything an image conveys, read it via its resource (`ReadMcpResource attachment://<id>`); the `uri` is right there in the payload's `attachments` array.
- **Give every image a short textual description** — in the markdown `alt` (`![a screenshot of the misaligned toggle button](…)`) and/or the surrounding prose — so lexical/semantic **search finds the card from words alone**. The description **aids discovery; it doesn't replace looking** — reopen the resource whenever you actually need the pixels.
- **An attachment is project-scoped — reuse it by reference across entities.** Any `att_…` already stored in the project renders wherever you embed `![alt](/attachments/<id>)` in markdown; it does **not** have to live on the same card/inbox/doc it was uploaded to. So to carry an inbox screenshot into a card, embed its `/attachments/<id>` reference (with a descriptive `alt`) in the card's `descriptionMd` — you reuse the same file by `id`, not a copy. There is **no MCP tool to upload a new attachment**: you can only reference `att_…` that already exist (uploaded via the web).

## Conventions

- The board only reflects reality if you keep statuses honest as you go.
- **Durable knowledge lives in docs, not in `CLAUDE.md`.** Architecture, data model, decisions (ADRs) and patterns belong in the docs — consult them, don't copy them into `CLAUDE.md`. Keep `CLAUDE.md` lean: it points at the project and its skills and holds only project-specific rules and overrides.
- Respect the repo's `CLAUDE.md`. When `CLAUDE.md` conflicts with a doc or this skill, `CLAUDE.md` wins — it's the project-specific override.
