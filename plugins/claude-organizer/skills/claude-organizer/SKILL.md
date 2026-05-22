---
name: claude-organizer
description: Use whenever the mcp__claude-organizer__* tools are available and you're about to start, continue, or execute development on a project tracked here. This skill is the source of truth for what to work on and how to keep the board honest — consult it at the START of every coding session (before exploring code) and as you work cards, comments and docs. Trigger even when the user just says "let's continue" or "what's next". To turn a NEW fuzzy demand into structured work (sprints/histories/tasks), use the `plan` skill instead. Do NOT rely on memory; read state from here.
---

# Using claude-organizer

claude-organizer is a "Jira for Claude Code" exposed over MCP. It holds a project's **cards** (tasks), **sprints**, **backlog**, **comments**, and **docs**. It is the **source of truth for what to work on and why** — not your memory, not assumptions. Whenever its tools are available, use them to orient yourself and to record what you do, so work survives across sessions.

A fresh session starts with no memory of past work. This system is how continuity is preserved: the active sprint says what matters now, cards carry the detail, comments carry the back-and-forth with the user, and docs carry the architecture and decisions. Read it first; keep it honest.

> **Planning vs. using.** This skill covers _using_ the board. When the user brings a **new demand** — a feature, a change, a fix — to turn into work, use the **`plan`** skill: it understands the demand and organizes it into sprints/histories/tasks. Then come back here to execute the cards.

## Start of every session — orient before touching code

Do this sequence _before_ exploring the codebase or making changes:

1. **`list_projects`** — find the project whose `slug` matches the repo you're working in, and grab its `projectId`. Every other tool takes an explicit `projectId`.
2. **`get_active_sprint(projectId)`** — what's being worked on right now.
3. **`list_unread_comments(projectId)`** — feedback the user left that you haven't seen yet. Read it and address it first; it's often a correction or a new priority.
4. **`list_cards`** — the cards in flight. Read **what's on the board now**, not just the active sprint:
   - `list_cards(projectId, sprintId=<active sprint>)` — the active sprint's cards.
   - `list_cards(projectId, backlogOnly=true)` — sprint-less cards. Those in a board status (`todo`…`done`) are **standalone cards on the board**; those in the `backlog` status are the **backlog**.

   The board = the active sprint's cards **plus** every sprint-less card in a board status, so a card you must work may belong to no sprint at all. Returns short summaries, so you can scan many quickly.

5. For one card's full detail: **`get_card(id)`** or **`get_card_by_key(key)`** (e.g. `ABC-12`).
6. For architecture, decisions, or how-tos: **`list_docs(projectId)`** + **`read_doc(id)`**, or **`search_docs`**. Projects document themselves here — read before reinventing or re-deciding something.

If no project matches the current repo, ask the user before creating one.

**Wire the repo link once.** After step 1, if the project has no `repoWebUrl`, detect the current repo's remote so commit hashes link to the provider: read `git remote get-url origin` (fallback: the first of `git remote -v`), convert it to a web URL (`git@github.com:owner/repo.git` or `https://github.com/owner/repo.git` → `https://github.com/owner/repo`; GitLab the same, subgroups included), pick the `provider` by host (`github`/`gitlab`; skip a self-hosted host you can't classify), and save it with `set_project_repo(projectId, provider, repoWebUrl)`. Skip when it's already set or there's no git remote.

## Before you analyze or act — read the tasks first, code second

Whether you're **starting a single card** or **analyzing a group of them** (the backlog, a sprint, a set of tech-debt cards, "what's left to do?"), read what the board already knows _before_ you open the codebase: each card's full **description** (`get_card` / `get_card_by_key`) **and its comments** (`list_comments`), plus which **sprint** it sits in. `list_cards` returns only short summaries — never base an analysis on summaries alone.

Comments routinely carry the decisive context: a card may be flagged _"consolidated into CO-31 — don't execute in isolation"_, already resolved, deferred, or superseded by another card. Skipping the comments and jumping to the code produces redundant or wrong conclusions (e.g. recommending work that's already planned elsewhere). **Order: tasks first (description + comments + sprint), then code only if still needed.**

**Re-read the board when you pick the next task — don't trust your earlier read or your memory.** Between cards the user may have added or pulled in work manually, re-prioritized, or left a comment. Before starting whatever's "next", re-query the board (active sprint **and** sprint-less `todo`/`backlog` cards) and check `list_unread_comments`, so you act on the current state — not a stale snapshot from earlier in the session.

## Working a card

1. **`set_card_status(id, "in_progress")`** before you start, so the board reflects reality.
2. **Read the card's comments first** — call **`list_comments(cardId)`** _before_ implementing. The user often leaves a correction or constraint on the **card itself**, not just in the session: a comment added after the initial briefing, or one you only skimmed, can change the whole approach. Address it before writing a line of code.
3. **Glance at the docs, then implement.** Scan the docs tree and read what's pertinent to this card's area — the relevant `module`, an `adr` that affects it, a `note` that might carry a constraint. Don't read unrelated docs (a back-end note for a front-end card), but do decide what's worth opening — important context often lives only there.
4. **`add_comment(cardId, ...)`** to record what carries **signal** — decisions, scope changes, deviations (see _Comments_). This is the project's memory for the next session.
5. **`set_card_status(id, "review")`** when you believe it's done — and post a **test plan** comment (see below). Then **wait for the user to validate**. Don't self-approve.
6. **Attach the commit's diff** — right after the commit lands (one commit per card, key in the message) and the user has confirmed. Run the capture script bundled with this skill: `node "<skill dir>/scripts/attach-commit.mjs" <sha>` — or `python3 "<skill dir>/scripts/attach-commit.py" <sha>` where Node isn't available — `<skill dir>` being this skill's own directory. It runs `git show` in the current repo and POSTs the diff straight to the API (`CO_API_URL`, default `http://127.0.0.1:4400`), so the card's **Changes** section shows what the commit produced. The diff is captured **outside your context on purpose** — **never read it or paste it into a comment** (it would burn tokens and add noise; see _Comments_).
7. **`set_card_status(id, "done")`** only after the user confirms.

## Git — agree on the flow before you start

Before implementing a story (or the first card of a batch), get the git flow straight — **don't assume**:

- If the repo's `CLAUDE.md` already defines a flow, follow it.
- Otherwise, when you're on `main`/`master`, **ask the user how to proceed**: a branch + PR? a branch merged later? commit straight on the current branch? **Mirror what the user already does** — some want a branch + PR per story, others a branch per task, others everything left in review on one branch.

A batch of several cards may mean **several branches** — warn the user that you'll need to **switch branches** between cards, and don't pile unrelated work onto one branch. Watch for **conflicts**: don't run far ahead in parallel if the work will collide; sequence dependent cards with the **blockers** system (a card `blocked by` another) so the order is explicit. Commit per card, following the repo's `CLAUDE.md` for the commit and versioning rules.

## Keep a history's status honest

A **history** (a parent card with sub-tasks) is a container, and its status should track its children instead of lagging behind them. The moment work starts on any child — you move the first sub-task to `in_progress`, or one is already `done` — move the history to `in_progress` too: a history sitting in `todo` while its tasks are underway misreads the board. Move it to `done` only when **every** child is `done`. The board shows each history's child counts, so an out-of-sync status is visible and confusing.

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

Learn the _criterion_ (signal vs. noise; deducible vs. new) — don't follow a fixed blacklist. "typecheck passed" is just one example of the concept.

**Test plan on review.** When you move a card to `review`, add **one comment** with how to validate it — what to open, what to do, what to expect (and what was already checked, briefly). The console scrollback is ephemeral; this comment is where the user (and you) sees exactly how to test what's in review.

User comments arrive flagged unread. `list_unread_comments` lists them _without_ marking them read; `list_comments(cardId)` marks that card's user comments as read. Check unread comments at session start **and** when you open a card.

## Cards — field reference

To organize a new demand into the right structure, use the **`plan`** skill. This is just the reference for the card fields:

- **`summary`** — one line (~100 chars) describing _what_ the card is about. It's what shows on the board and in `list_cards`.
- **`descriptionMd`** — the spec: _behavior and intent_, acceptance criteria, decisions — **not** implementation code.
- **Sprint and status together decide where a card shows.** A card with **no `sprintId`** is sprint-less: in the **`backlog`** status it sits in the backlog; in a board status (`todo`…`done`) it's a **standalone card on the board**. A card in a sprint shows on the board while that sprint is active. New cards default to `backlog` when created with no sprint, `todo` when created in a sprint.
- **`parentId`** makes a card a sub-task of a **history** (one level). A card can be **blocked by** others (add/remove blockers) — the board flags it while a blocker isn't `done`.

**Always tag a task after creating it.** Attach the tag(s) that fit — area/layer (e.g. `web`, `api`, `mcp`) or type (e.g. `bug`). If no existing tag fits, **suggest new tag(s) and ask the user before creating them** — never invent tags silently. Tagged cards keep the board filterable and scannable.

## Docs — read before building, record after deciding

Docs are organized into **four top-level groups**; put each new doc under the right one:

- **Modules** (`module`) — one doc per code area/feature: what it does, how it's used, what it depends on.
- **Decisions / ADRs** (`adr`) — **one decision per doc** (_Context · Decision · Consequences_, terse). Don't pile decisions into a single doc.
- **Guides** (`guide`) — how-tos and references.
- **Notes** (`note`) — loose context, pending items, observations.

**Consult the docs before creating or executing a task.** Scan the docs tree first and read what's relevant to the task's area — the `module` for the code you'll touch, an `adr` for a decision that affects it, a `note` that might carry a constraint. You don't need to read _everything_ (no need to read a back-end note for a front-end task), but you DO need to glance at the tree and decide what's worth opening. Important context often lives only in a doc.

Use **`write_doc`** (no `id` creates, `id` updates; pass `parentId` to nest under a group), **`search_docs`** to find, **`read_doc`** for full content. When you make a notable decision, write an `adr` (under the Decisions group) — terse is fine; the _why_ is what matters.

## Conventions

- The board only reflects reality if you keep statuses honest as you go.
- New demand → **`plan`** skill (understand & organize) before executing.
- **Durable knowledge lives in docs, not in `CLAUDE.md`.** Architecture, data model, decisions (ADRs) and patterns belong in the docs — consult them, don't copy them into `CLAUDE.md`. Keep `CLAUDE.md` lean: it points at the project and its skills and holds only project-specific rules and overrides.
- Respect the repo's `CLAUDE.md`. When `CLAUDE.md` conflicts with a doc or this skill, `CLAUDE.md` wins — it's the project-specific override.
