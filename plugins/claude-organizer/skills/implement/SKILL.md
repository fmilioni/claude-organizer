---
name: implement
description: Use to EXECUTE a card that already exists on the board in claude-organizer — a sprint, a story, or a single task. Trigger the moment you start, resume, or continue development on a specific card ("work CO-42", "implement this story", "continue the task", "build it now"). Owns the mandatory execution lifecycle (in_progress → read comments → implement → review → commit → done) and NEVER assumes — any open decision the card doesn't settle goes to the user first. To break a NEW demand into cards use `plan` instead (including a task from an external tracker — re-map it, don't execute here); to orient, see `claude-organizer`. Do NOT skip steps.
---

# Implementing a card

This skill governs the **execution of a card that already exists** on the board — a task, a history (story), or the cards of a sprint. Planning produced the card; here you build it and walk it through its lifecycle while keeping the board honest. To break a new demand into cards, use **`plan`** — not this skill.

**Guard — a task from an external tracker is not a card here.** If the user asks you to implement a task that lives in another tracker (a company issue tracker, a different tool) and hasn't given you a local `CO-N`, that's a **planning input**: send it through **`plan`** to be understood, dimensioned, and re-mapped into local card(s) first. Only a local card key is executable here.

<SKILL-GATE>
**Load the `claude-organizer` panorama first.** This skill assumes you are oriented on the board. If you have **not** already loaded the **`claude-organizer`** skill in this conversation, invoke it now (Skill tool) and run its start-of-session orientation **before** anything below. If it is already loaded in this conversation, don't reload it — just continue. Don't enter this skill cold.
</SKILL-GATE>

<HARD-GATE>
Every step in **The lifecycle** below is **MANDATORY and ORDERED**, for **every** card — trivial or not. You do **not** skip a step, reorder it, or fold it away because it "seems unnecessary", you "already did it earlier" (this session, the parent history, a sibling task), the card is "too small", or you judged it faster to go straight to code.

Skipping a step — not flipping status, not re-reading this card's comments, **skipping the per-task review gate before commit**, committing before the user reviews, not attaching the commit, not moving to `done` after validation — is a **defect**, not an optimization. When in doubt, do the step.
</HARD-GATE>

## Never assume — ask the user

Execution constantly hits things the card didn't fully nail down. **Never assume your way past one — ask.** Two kinds of unknown both block well-formed work; resolve both **before** writing code:

- **Ambiguity** — anything unclear about what the user wants: vague wording, an unstated expectation, an edge case nothing mentions, "did they mean X or Y?". Even a *small* one gets a question — don't settle it by guessing the "probably intended" reading.
- **Decision** — an open choice where more than one reasonable path exists: which library or existing helper, how to shape data, where code lives, a naming/contract call, behavior on an edge case.

The **method**:

- **Ambiguity → a direct question** (open-ended where that fits). **Decision → ready-made options**, never "what do you think?": each option concrete and worked out, with its **trade-offs**. Mark the recommended option in its label (the *why* may go in the description), list it first, in the user's language (e.g. `(Recommended)`, `(Recomendado)`) — what `AskUserQuestion` expects. That serves both the user who takes the recommendation and the one who knows enough to choose differently.
- **One topic per message**; prefer multiple-choice via the `AskUserQuestion` tool.
- **Unknowns chain** — settle the earlier one first; it narrows the next.
- **Research when knowledge alone won't yield good options**, then present what you found.
- **State the approach before building** — say in plain terms what you're about to do, so the user can catch a wrong assumption *before* it's code.

**Check before you ask** — the answer may already exist in the card's **description** or its **comments** (step 2); read them first and don't re-litigate a settled call. **Record the answer** as a **comment** (step 5), and when it changes the spec, fold it into the **description** too, so a fresh executor reads a card that's already decided. **When to stop:** keep going until nothing material is left to guess — assuming instead of asking is a **defect**, the same as skipping a lifecycle step.

Two things specific to execution:

- **Hit one mid-build → stop and ask.** Don't push past it. Fold the answer back in and record it as a **comment** (it's signal — step 5), so it survives for the next session.
- **A story is decided up front, as a whole.** Before building a story, **read all of its cards** (description + comments) and gather **every** open decision and ambiguity across them, then clear them with the user **before writing code** — surface the batch one per message, chained. Don't start card 1, hit a fork mid-way, and guess.

## The lifecycle — every card, every time, in order

> **Driven by the autopilot?** If the orchestrator's prompt says you're in **runner mode**, read _Runner mode — when the autopilot orchestrator drives_ (below) **first**: you do the build but skip the review gate, the commit, and the status/`done` moves, and you **return** a structured result instead of asking the user or closing the card.

### 1. Re-read the board, then move the card to `in_progress`

- **Re-read before you start.** Don't trust an earlier read or your memory — between cards the user may have re-prioritized, pulled in work, or left a comment. Re-query the active sprint and the sprint-less `todo`/`backlog` cards, and check `list_unhandled_comments`, so you act on the **current** state.
- **`set_card_status(id, "in_progress")` the moment you pick the card up** — before writing a line of code, even for a one-line change. A card being worked while it still reads `todo` is the board lying.
- **Reserve the work** — `claim_task(<key>, <sessionToken>, <label>)` (advisory — see _Reserving the card_). **When the card belongs to a story, claim the parent story's key**, not just this child: claiming a story cascades the reservation to **all** its `todo` children, so the rest of the story can't be picked up by another session while you work it. (A standalone card claims only itself.) A **conflict** (held by another session) → **stop and ask** before taking it over; don't just start.
- If it's a sub-task, move its **history** to `in_progress` now too (see _History status_).

### 2. Read THIS card's comments — `list_comments(cardId)` — even if you read them before

This is the step most often skipped, and skipping it is where the work goes wrong.

- Call **`list_comments(cardId)` before implementing, every card, every time** — including each sub-task of a history — **even if you read them earlier**: something **new** may have landed since (a correction, a constraint, a scope change posted after the briefing or while you were on another card).
- Reading the **history's** comments does **not** cover its children, and a sibling task having none does **not** mean this one does. Comments are **per-card**.
- **Comments are where settled decisions live** — the answer to a question you'd otherwise ask may already be here. Read them so you don't re-ask, and don't assume past what they say.
- **Reading the thread advances state.** Calling `list_comments(cardId)` over MCP **advances this card's `unread` user comments to `read`** — the act of reading is recorded; you've seen them. It does not mark them `handled`. Then, once you've **actually addressed** a comment (not just read it), call **`mark_comments_handled([...commentIds])`** so it leaves the unhandled queue for good — handle each as you act on it, never leave a comment stuck in `read` once you've dealt with it.

### 3. Read the relevant docs

Scan the docs tree (`list_docs` / `search_docs`) and read what's pertinent to this card's area — the `module` for the code you'll touch, an `adr` that affects it, a `note` that may carry a constraint. Don't read unrelated docs; do decide what's worth opening. Important context often lives only there.

### 4. Implement — write clean code from the start

Build the card, following the repo's `CLAUDE.md` and the agreed git flow (see _Git flow_). Stay within the card's scope; if scope shifts, that's a comment (step 5) — and possibly a new card via `plan`. **The moment you hit an ambiguity or a decision the card doesn't settle, stop and ask** — don't assume your way forward; fold the answer back in and record it as a comment.

**If the card or its comments carry an image, open it before you build.** The read payloads (`get_card`, `list_comments`) expose an `attachments` array with `attachment://<id>` URIs — read the resource (`ReadMcpResource`) and actually look at the image. A markdown link isn't "seen", and the textual description only points you to it. The image isn't always a mockup to reproduce — it may be a reference or example from another system, documentation, or text conveyed as a screenshot; look at what it actually carries and build on that, rather than guessing from its description.

**Write code without needless comments from the start** — don't leave for the review what shouldn't be written in the first place:

- **Don't comment _what_ the code does** — the identifiers already say it (`const total = sum(items)` needs no `// sum the items`).
- **Don't narrate** the task, the decision, or the change in code or comments, and **don't leave card/ticket references** in the source — that belongs in the commit message and on the card, where it won't rot on the next refactor.
- **Comment only what the code can't say for itself**: a non-obvious **why**, a subtle **invariant or constraint** the caller must preserve, a **workaround** tied to a specific quirk, or the **doc of a public function/API**. One short line where it earns its place — if you can't put the *why* in a line, the code likely needs a better name or shape, not a comment.

This is the **source** of the clean-code rule; the review gate (step 7) only catches what slips through — a safety net, not where cleanup is born.

**Self-review before you hand off.** Before you treat the card as built, read your **own diff back with fresh eyes**. This doesn't make you a fair judge of your own code (that's the gate's job — step 7), but an honest quick pass catches the easy misses, far cheaper than spending the gate on them. Check:

- **Acceptance criteria** — does the change meet **every** criterion the card states, not just the headline one?
- **YAGNI / discipline** — did you build **only** what was asked — nothing speculative or extra — following the codebase's existing patterns?
- **Quality** — do names say what things do; is the code clean; did you leave a comment the gate will only flag?
- **Verification** — do your checks actually exercise the **behavior**, not just a happy-path smoke?

Fix what you find **inline**, now. This does **not** replace the per-task review gate (step 7) — the self-review just keeps the obvious from reaching it.

### 5. Record signal as comments

As you work, **`add_comment(cardId, …)`** for what carries **signal** — decisions and why, scope changes, deviations from what the card asked, domain insights, edge cases. Skip noise (the plan, narration, "typecheck passed"). The signal-vs-noise criterion lives in the **`claude-organizer`** skill — follow it. This is the project's memory for the next session.

### 6. Move to `review` the moment you hand off — **even if you haven't committed**

- **`set_card_status(id, "review")` the instant you stop and the user takes over** to validate. Status reflects **who holds the ball**, not whether a commit exists — so move it even though the commit lands only after the user confirms (steps 7–10).
- On the **same move**, post **one** comment with the **test plan**: what to open, what to do, what to expect, and briefly what you already checked. Console scrollback is ephemeral; this comment is where the user (and a future session) sees how to validate what's in review. It follows the same signal-vs-noise rule as any comment.
- Then **capture the working-tree diff onto the card** with this skill's bundled `attach-worktree-diff` script (see _Diff-capture scripts — they ship inside this skill_ for where it lives and how to run it). The diff goes straight to the API **outside your context** — don't read or paste it (step 10). This lets the user see what will land before any commit exists. (Token only when auth is on — see _Auth flag for diff capture_.)
- Then **wait for the user to validate**. Do **not** self-approve and do **not** jump ahead to commit or `done`.

### 7. Per-task review gate — a fresh subagent, **before commit** (mandatory — do not skip)

With the behavior validated, run the **per-task review** via the **`review`** skill **before** committing — over the **working-tree diff** (`git diff`), so any fixes fold into the change and the card keeps **one clean commit**. It spawns a **fresh subagent** (objective eyes — you just wrote this code, so you're the worst judge of it) that checks **this task's acceptance criteria** and hunts for reuse / dead code / leftover comments. The `review` skill then **disposes of every finding** — cheap in-scope ones get fixed, the rest go to the user — and **you don't get to veto a finding because it's `low` or "not worth a cycle"**: severity ranks the list, it doesn't authorize dropping it (the full rule lives in the `review` skill). When fixes fold into the working tree, **re-run the `attach-worktree-diff` script** so the pending diff reflects the adjusted change.

**This gate is the step most skipped — including on cards that are not remotely trivial. That is the exact defect this rule exists to stop.** For **any card with real logic**, the per-task review runs **every time, with no judgment call** — you do not get to decide the change "looks fine" and commit past it. The **only** exception is a change with **no real logic at all** (a one-liner, a rename, a config tweak, a pure copy move), and even then the skip is **not silent**: **record the skip and its reason as a comment on the card** so it's visible and auditable. When in doubt, review. For a **standalone** task (no parent), this per-task review *is* the whole review — there's no story layer above it.

### 8. Let the user review the diff

With the behavior validated and the per-task review settled, wait for the user's go-ahead on the **actual diff** (not just the behavior) — don't commit on your own initiative.

### 9. Capture durable knowledge in the docs

Ask once: **did a decision, a standardization, or long-lived knowledge surface while building this card?** If so, **write or update the doc now** — an `adr` for a decision (with the _why_), the matching `guide`/`module` for a new or changed convention, a `module`/`note` for a durable gotcha. Prefer **updating** an existing doc over creating a second; **skip** the ephemeral or deducible (no doc spam). The full criterion lives in the **`claude-organizer`** skill (_Docs_). Docs live in the MCP, not in git, so this is independent of the commit below.

### 10. Commit, then attach the commit's diff to the card — **always**

- After the user confirms, create **one commit per card**, message in English referencing the key (e.g. `feat(tags): … (CO-4)`), per the repo's `CLAUDE.md` (commit + versioning rules).
- **Always attach the commit's diff** right after it lands with this skill's bundled `attach-commit` script (see _Diff-capture scripts — they ship inside this skill_). It runs `git show` and POSTs the diff to the API (`CO_API_URL`, default `http://127.0.0.1:4400`), so the card's **Changes** section shows what the commit produced. (Token only when auth is on — see _Auth flag for diff capture_.)
- The diff is captured **outside your context on purpose** — **never read it or paste it into a comment** (it burns tokens and adds noise).
- Attaching the real commit **clears the pending working-tree diff** automatically (the `__working__` sentinel row is dropped), so the card swaps from "uncommitted" to the committed diff with no manual cleanup on the happy path.

### 11. Move to `done` — **always**, only after the user confirms

**`set_card_status(id, "done")`** once the user has confirmed it works. Don't leave a validated card sitting in `review`, and never mark `done` before validation.

If this is the **last child of a story**, the **story-level review gate** fires **before** the story closes: an additional `review`-skill pass over the **whole story** (≈ one PR, `git diff <base>...HEAD`), scoped to what a single task can't see — the **story's acceptance criteria**, **duplication across tasks**, **coherence of the PR**; it does not re-review each task line-by-line (the per-task gates already did). Only then move the history to `done` too (see _History status_).

At this story boundary — and before advancing to the next card/story or ending the session — re-check the inbox **fresh**: call **`list_inbox` (pending)** again (don't trust the orientation snapshot — the user may have dropped demands while you worked). If it surfaces pending demands the work didn't cover, **stop and ask** whether to review/plan them now (a decision gate — they may **reshape the upcoming stories**). The criterion and wording live in the **`claude-organizer`** skill (_Inbox_).

## Runner mode — when the autopilot orchestrator drives

The **`autopilot`** skill runs a card by dispatching a subagent that invokes this skill. A subagent hits two hard limits the normal lifecycle assumes away: it **cannot spawn another subagent** (so it can't fire the review gate) and **cannot talk to the user** (`AskUserQuestion` is unavailable to it). So **only when the orchestrator says it is driving** (it states so explicitly in the task prompt — never infer runner mode on your own), you do the **build** and the orchestrator owns the **board lifecycle around you**. Concretely:

- **You do:** the orchestrator has already moved the card to `in_progress` and claimed it (the claim is advisory and doesn't move status, so the orchestrator owns that transition). You have **no board (claude-organizer MCP) tools** — the orchestrator **curates** the card, the **relevant comment info** (step 2) and the **relevant docs** (step 3) into your prompt; work from that, don't fetch the board. **Implement clean** (step 4), and **self-review your own diff** (step 4). Off-limits to you: spawning subagents, `AskUserQuestion`, and every board read/write. So capture signal (step 5) and durable doc knowledge (step 9) but **return them as data** (`comments`/`docs`); the orchestrator writes them.
- **You do NOT:** read or write the board (no comments, no docs, no status — you have no board tools), spawn the review gate (step 7), let the user review the diff (step 8), commit and attach the diff (step 10), or do the `review`/`done` status moves — including step 6's move to `review` with its test-plan comment and worktree-diff attach — or release the claim. The orchestrator runs the reviewer as a **sibling** subagent, posts your returned signal/docs, applies fixes, commits on the run's single branch, attaches the diff, and moves the card to `review`.
- **You never ask — you stop and return.** The instant you hit a decision or ambiguity the card doesn't settle (the _Never assume_ rule still holds — you just can't resolve it via the user yourself), **halt** and **return** it. The orchestrator takes it to the user and re-dispatches you with the answer.

**Return contract** — your final message **is** the orchestrator's input (structured data, not prose for a human). Return exactly one of:

- `{ status: "needs_decision", decision, options, recommendation }` — you hit an unsettled choice. State it, the worked options with trade-offs, and your recommendation (same bar as the _Never assume_ method). You will be re-dispatched with the user's answer.
- `{ status: "ready_for_review", summary, files, testPlan, comments, docs }` — built and self-reviewed up to the pre-review point, nothing left to decide. `summary` is what you changed and why; `files` the touched paths; `testPlan` how to validate it (what to open, do, expect) — the orchestrator posts it as the card's test-plan comment when it moves the card to `review`. `comments` is any **signal** to post on the card and `docs` any **durable knowledge** to record — written as plain content (what + why + the area/doc it concerns); the orchestrator files it into the docs. Both optional, since you can't write the board yourself.
- `{ status: "blocked", reason }` — you cannot proceed (a missing dependency, a broken precondition).

Keep this contract in sync with the **`autopilot`** skill, which consumes it.

**Outside runner mode — a normal, user-driven run — this section does not apply:** you own the full lifecycle above, commit after the user confirms, and close the card yourself.

## Diff-capture scripts — they ship inside this skill

`attach-commit` and `attach-worktree-diff` are **not** an npm package and **not** guaranteed to be a `package.json` script in the repo you're working in. They are **bundled in this skill**, at `scripts/attach-commit.mjs` and `scripts/attach-worktree-diff.mjs` (Python twins `.py` for hosts without Node) — the path is **relative to this skill's own base directory**, not the project's working dir. So locate them under the directory this `SKILL.md` was loaded from and run that copy **by its absolute path**:

```bash
node "<this skill's directory>/scripts/attach-commit.mjs" <sha>
node "<this skill's directory>/scripts/attach-worktree-diff.mjs" <CO-N>
```

`pnpm attach-commit <sha>` / `pnpm attach-worktree-diff <CO-N>` are a convenience **only in the claude-organizer dev repo** (where those `package.json` scripts exist). Anywhere else, call the bundled script by its path — **don't** `pnpm`-run a script that isn't there, and **don't** try to install anything from npm.

## Auth flag for diff capture — read it from CLAUDE.md

The diff-capture scripts (`attach-worktree-diff`, `attach-commit`) need a card-scoped token **only when auth is on**. Don't probe the server before every attach — read the flag the project's **`CLAUDE.md`** records, and act on it:

- **Auth on** → mint `issue_commit_token(<CO-N>)` and pass it in `CO_COMMIT_TOKEN` (e.g. `CO_COMMIT_TOKEN=<token> node "<this skill's directory>/scripts/attach-commit.mjs" <sha>`); the token is short-lived and card-scoped, so mint one per attach.
- **Auth off, or no flag yet** → run the script tokenless.
- **Self-healing** — if an attach unexpectedly returns **401**, auth is actually on: write the flag to `CLAUDE.md` (auth **on**), then retry the attach with a token.

## Git flow — agree before you start

Before implementing a story (or the first card of a batch), get the git flow straight — **don't assume**:

- If the repo's `CLAUDE.md` already defines a flow, follow it.
- Otherwise, on `main`/`master`, **ask the user how to proceed**: a branch + PR? a branch merged later? commit straight on the current branch? **Mirror what the user already does.**

A batch of several cards may mean **several branches** — warn the user you'll need to **switch branches** between cards, and don't pile unrelated work onto one branch. Watch for **conflicts**: don't run far ahead in parallel if the work will collide; sequence dependent cards with the **blockers** system (a card `blocked by` another) so the order is explicit.

**Isolating work in a worktree?** Use the standard location **`.claude/worktrees/<branch>`**, not an ad-hoc `../<name>`: the path is fixed, so don't ask where to put it. Three steps, in order:

1. **Before `git worktree add`, ensure `.claude/worktrees/` is in `.gitignore`** — check it's there and add it if missing. This is a **prerequisite**, not an afterthought folded into the create: the worktree lives inside the repo, so without the ignore already in effect the parent repo sees the directory as untracked, committable content the moment the worktree is born.
2. **After creating it, make sure the worktree's dependencies are in place before any typecheck/lint/build/test** — a fresh worktree starts **without the project's installed dependencies**. Verify they resolve and, if they don't, install them the way the project already installs — **whatever the stack** (Node, PHP, Go, Rust, Python, …): you know the project's tooling, so use its install command (`pnpm install`, `composer install`, `go mod download`, `cargo fetch`, `pip install`, …). Without this those checks break on missing deps. This is the **project's own** dependencies — unrelated to the `attach-*` scripts' "don't install anything from npm" rule above, which is only about this skill's bundled scripts.
3. **Remove it when you're done** — once the PR is open, and certainly after a merge: `git worktree remove`. Don't leave an orphaned worktree behind.

(The `autopilot` skill follows the same convention.)

## Reserving the card — advisory claim

The board coordinates parallel sessions/machines with an **advisory** claim: it signals "this card is in my work buffer" so another session doesn't start the same thing. Nothing is locked (the API never blocks on it); the skill is what respects it.

- **One session token per run.** At the start of a run, generate a single opaque `sessionToken` and a readable `label`, and **reuse both** for every claim/release/take-over this run — don't mint a new one per card. **The `label` is the user's full name** (e.g. `Felipe Milioni`) — **never** just the first name, **never** the email. Source it from the **auth identity when auth is on**, otherwise from `git config user.name`; if no name resolves at all, fall back to a **generic session label** (e.g. `session <short-token>`) — **never** the email as the fallback.
- **Claim when you pick a card up** (step 1): `claim_task(<key>, <sessionToken>, <label>)`. Claiming a **story** cascades the reservation to **all** its not-yet-started (`todo`) children — so when the card you start belongs to a story, **claim the parent story's key**, reserving the whole story up front instead of one child at a time (a child already in `in_progress`/`review`/`done` is left untouched). Picking up a **standalone** card claims only that card. Reserved cards show an hourglass on the board.
- **Conflict = held by another session.** `claim_task` returns `{ ok:false, conflict:true, claim }` **without changing anything**. **Stop and ask the user** — _"`<key>` is reserved by `<claim.ownerLabel>` since `<claim.claimedAt>`; take it over?"_ On **yes**, `take_over_task(<key>, <sessionToken>, <label>)` swaps the token to you; on **no**, don't start that card. **Take-over is always user-confirmed.**
- **Release.** Completing the card (`done`) **auto-releases** the claim. If you **abandon/cancel** a card without finishing, `release_task(<key>, <sessionToken>)`. A **CTRL-C keeps** the claim on purpose, so you can resume; resuming in a **new run** mints a new token, so your own earlier claim now reads as a conflict → the take-over prompt above retakes it.

## History status — keep it honest as children move

A **history** (a parent card with sub-tasks) is a container; its status tracks its children. The moment work starts on any child — you move the first sub-task to `in_progress`, or one is already `done` — move the history to `in_progress` too. Move it to `done` only when **every** child is `done`. The board shows each history's child counts, so an out-of-sync status is visible and confusing.

## The quick checklist

Per card, in order — no step skipped. **Standing rule: never assume — any ambiguity or decision the card doesn't settle goes to the user before you build; for a story, clear all of them up front.**

1. Re-read the board → `claim_task` (a sub-task → claim the parent story; conflict → ask, then take-over) → `in_progress` (history too, if a sub-task).
2. `list_comments(cardId)` — even if read before; reading advances `unread → read`, then `mark_comments_handled` once you've actually addressed them.
3. Read the relevant docs.
4. Implement — clean code, no needless comments; hit a doubt → stop and ask; then self-review your own diff with fresh eyes before handing off (doesn't replace the gate).
5. Comment the signal.
6. `review` status + test-plan comment + `attach-worktree-diff` → wait for validation.
7. Per-task review gate (fresh subagent) — **mandatory for any card with real logic**; the only skip is a no-logic change, and even then record the skip + reason on the card → every finding fixed or surfaced, never dropped on severity → fixes fold in → re-run `attach-worktree-diff`.
8. Let the user review the diff.
9. Capture durable knowledge in the docs.
10. Commit (one per card, key in message) → `attach-commit`.
11. `done` after the user confirms — story's last child → story-level review gate first, then close the history; re-check the inbox fresh at the boundary.
