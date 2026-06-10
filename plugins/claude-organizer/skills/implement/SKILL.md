---
name: implement
description: Use to EXECUTE a card that already exists on the board in claude-organizer — implement a sprint, a history/story, or a single task. Trigger the moment you start, resume, or carry out development on a specific card ("work CO-42", "let's implement this story", "continue the task", "build it now"). This skill owns the mandatory execution lifecycle: in_progress → read comments → implement → review → commit → done. It NEVER assumes — any ambiguity or open decision the card doesn't settle goes to the user first (options + recommendation, like `plan`), and answers live in comments. To turn a NEW fuzzy demand into cards, use `plan` instead — this includes a task that lives in an external tracker (no local card key yet), which is a planning input you re-map via `plan`, never execute here; to orient/keep the board honest, see `claude-organizer`. Do NOT skip steps.
---

# Implementing a card

This skill governs the **execution of a card that already exists** on the board — a task, a history (story), or the cards of a sprint. Planning produced the card; here you build it and walk it through its lifecycle while keeping the board honest. To break a new demand into cards, use **`plan`** — not this skill.

**Guard — a task from an external tracker is not a card here.** If the user asks you to implement a task that lives in another tracker (a company issue tracker, a different tool) and hasn't given you a local `CO-N`, that's a **planning input**: send it through **`plan`** to be understood, dimensioned, and re-mapped into local card(s) first. Only a local card key is executable here.

<SKILL-GATE>
**Load the `claude-organizer` panorama first.** This skill assumes you are oriented on the board. If you have **not** already loaded the **`claude-organizer`** skill in this conversation, invoke it now (Skill tool) and run its start-of-session orientation **before** anything below. If it is already loaded in this conversation, don't reload it — just continue. Don't enter this skill cold.
</SKILL-GATE>

<HARD-GATE>
Every step in **The lifecycle** below is **MANDATORY and ORDERED**, for **every** card — trivial or not. You do **not** skip a step, reorder it, or fold it away because it "seems unnecessary", you "already did it earlier" (this session, the parent history, a sibling task), the card is "too small", or you judged it faster to go straight to code.

The board is only honest if **every** card walks the **full** lifecycle in lockstep with the real work. Skipping a step — not flipping status, not re-reading this card's comments, committing before the user reviews, not attaching the commit, not moving to `done` after validation — is a **defect**, not an optimization. When in doubt, do the step.
</HARD-GATE>

## Never assume — ask the user

Execution constantly hits things the card didn't fully nail down. **Never assume your way past one — ask.** Two kinds of unknown both block well-formed work; resolve both **before** writing code:

- **Ambiguity** — anything unclear about what the user wants: vague wording, an unstated expectation, an edge case nothing mentions, "did they mean X or Y?". Even a *small* one gets a question — don't settle it by guessing the "probably intended" reading.
- **Decision** — an open choice where more than one reasonable path exists: which library or existing helper, how to shape data, where code lives, a naming/contract call, behavior on an edge case.

The **method**:

- **Ambiguity → a direct question** (open-ended where that fits). **Decision → ready-made options**, never "what do you think?": each option concrete and worked out, with its **trade-offs**. Mark the one you recommend with a **recommended marker** in the option's **title/label**, written in the **same language as the question** (the user's language — e.g. `(Recommended)` in English, `(Recomendado)` in pt-BR) — not buried in its description — and list it **first** (the marker goes in the title; the *why* may go in the description). That serves both the user who takes the recommendation and the one who knows enough to choose differently. This is what `AskUserQuestion` expects: recommended option first, marked in its label.
- **One topic per message**; prefer multiple-choice via the `AskUserQuestion` tool.
- **Unknowns chain** — settle the earlier one first; it narrows the next.
- **Research when knowledge alone won't yield good options**, then present what you found.
- **State the approach before building** — say in plain terms what you're about to do, so the user can catch a wrong assumption *before* it's code.

**Check before you ask** — the answer may already exist in the card's **description** or its **comments** (step 2); read them first and don't re-litigate a settled call. **Record the answer** as a **comment** (step 5), and when it changes the spec, fold it into the **description** too, so a fresh executor reads a card that's already decided. **When to stop:** keep going until nothing material is left to guess — assuming instead of asking is a **defect**, the same as skipping a lifecycle step.

Two things specific to execution:

- **Hit one mid-build → stop and ask.** Don't push past it. Fold the answer back in and record it as a **comment** (it's signal — step 5), so it survives for the next session.
- **A story is decided up front, as a whole.** Before building a story, **read all of its cards** (description + comments) and gather **every** open decision and ambiguity across them, then clear them with the user **before writing code** — surface the batch one per message, chained. Don't start card 1, hit a fork mid-way, and guess.

## The lifecycle — every card, every time, in order

### 1. Re-read the board, then move the card to `in_progress`

- **Re-read before you start.** Don't trust an earlier read or your memory — between cards the user may have re-prioritized, pulled in work, or left a comment. Re-query the active sprint and the sprint-less `todo`/`backlog` cards, and check `list_unread_comments`, so you act on the **current** state.
- **`set_card_status(id, "in_progress")` the moment you pick the card up** — before writing a line of code, even for a one-line change. A card being worked while it still reads `todo` is the board lying.
- **Reserve the card** — `claim_task(<key>, <sessionToken>, <label>)` (advisory — see _Reserving the card_). A **conflict** (held by another session) → **stop and ask** before taking it over; don't just start.
- If it's a sub-task, move its **history** to `in_progress` now too (see _History status_).

### 2. Read THIS card's comments — `list_comments(cardId)` — even if you read them before

This is the step most often skipped, and skipping it is where the work goes wrong.

- Call **`list_comments(cardId)` before implementing, every card, every time** — including each sub-task of a history.
- **Re-read even if you read them earlier** — something **new** may have landed since: a correction, a constraint, a scope change posted after the briefing or while you were on another card.
- Reading the **history's** comments does **not** cover its children, and a sibling task having none does **not** mean this one does. Comments are **per-card**.
- **Comments are where settled decisions live** — the answer to a question you'd otherwise ask may already be here. Read them so you don't re-ask, and don't assume past what they say.
- **`list_comments` is read-only — it doesn't mark anything.** Once you've **addressed** the user's comments on this card (not just read them), mark them with **`mark_comments_read([...commentIds])`** so they leave the unread queue — do it as you take the card up, not while merely browsing.

### 3. Read the relevant docs

Scan the docs tree (`list_docs` / `search_docs`) and read what's pertinent to this card's area — the `module` for the code you'll touch, an `adr` that affects it, a `note` that may carry a constraint. Don't read unrelated docs; do decide what's worth opening. Important context often lives only there.

### 4. Implement — write clean code from the start

Build the card, following the repo's `CLAUDE.md` and the agreed git flow (see _Git flow_). Stay within the card's scope; if scope shifts, that's a comment (step 5) — and possibly a new card via `plan`. **The moment you hit an ambiguity or a decision the card doesn't settle, stop and ask** — don't assume your way forward; fold the answer back in and record it as a comment.

**If the card or its comments carry an image, open it before you build.** The read payloads (`get_card`, `list_comments`) expose an `attachments` array with `attachment://<id>` URIs — read the resource (`ReadMcpResource`) and actually look at the image. A markdown link isn't "seen", and the textual description only points you to it; build against the pixels, not a guess.

**Write code without needless comments from the start** — don't leave for the review what shouldn't be written in the first place:

- **Don't comment _what_ the code does** — the identifiers already say it (`const total = sum(items)` needs no `// sum the items`).
- **Don't narrate** the task, the decision, or the change in code or comments, and **don't leave card/ticket references** in the source — that belongs in the commit message and on the card, where it won't rot on the next refactor.
- **Comment only what the code can't say for itself**: a non-obvious **why**, a subtle **invariant or constraint** the caller must preserve, a **workaround** tied to a specific quirk, or the **doc of a public function/API**. One short line where it earns its place — if you can't put the *why* in a line, the code likely needs a better name or shape, not a comment.

This is the **source** of the clean-code rule; the review gate (step 7) only catches what slips through — a safety net, not where cleanup is born.

**Self-review before you hand off.** Before you treat the card as built, read your **own diff back with fresh eyes**. You're the worst judge of code you just wrote — but an honest quick pass still catches the easy misses, and that's far cheaper than spending the review gate on them. Check:

- **Acceptance criteria** — does the change meet **every** criterion the card states, not just the headline one?
- **YAGNI / discipline** — did you build **only** what was asked — nothing speculative or extra — following the codebase's existing patterns?
- **Quality** — do names say what things do; is the code clean; did you leave a comment the gate will only flag?
- **Verification** — do your checks actually exercise the **behavior**, not just a happy-path smoke?

Fix what you find **inline**, now. This does **not** replace the per-task review gate (step 7) — the fresh subagent stays mandatory because your confidence is exactly what it exists to test; the self-review just keeps the obvious from reaching it.

### 5. Record signal as comments

As you work, **`add_comment(cardId, …)`** for what carries **signal** — decisions and why, scope changes, deviations from what the card asked, domain insights, edge cases. Skip noise (the plan, narration, "typecheck passed"). The signal-vs-noise criterion lives in the **`claude-organizer`** skill — follow it. This is the project's memory for the next session.

### 6. Move to `review` the moment you hand off — **even if you haven't committed**

- **`set_card_status(id, "review")` the instant you stop and the user takes over** to validate. Status reflects **who holds the ball**, not whether a commit exists — so move it even though the commit lands only after the user confirms (steps 7–10).
- On the **same move**, post **one** comment with the **test plan**: what to open, what to do, what to expect, and briefly what you already checked. Console scrollback is ephemeral; this comment is where the user (and a future session) sees how to validate what's in review. It follows the same signal-vs-noise rule as any comment.
- Then **capture the working-tree diff onto the card** with this skill's bundled `attach-worktree-diff` script (see _Diff-capture scripts — they ship inside this skill_ for where it lives and how to run it). The diff goes straight to the API **outside your context** — **never read or paste it**. This lets the user see what will land before any commit exists. (Token only when auth is on — see _Auth flag for diff capture_.)
- Then **wait for the user to validate**. Do **not** self-approve and do **not** jump ahead to commit or `done`.

### 7. Per-task review gate — a fresh subagent, **before commit** (skip only if trivial)

With the behavior validated, run the **per-task review** via the **`review`** skill **before** committing — over the **working-tree diff** (`git diff`), so any fixes fold into the change and the card keeps **one clean commit**. It spawns a **fresh subagent** (objective eyes — you just wrote this code, so you're the worst judge of it) that checks **this task's acceptance criteria** and hunts for reuse / dead code / leftover comments, then reports and asks what to do (fix now / follow-up card / other). When fixes fold into the working tree, **re-run the `attach-worktree-diff` script** so the pending diff reflects the adjusted change.

A **trivial** task (one-liner, rename, config — nothing with real logic) may **skip** this by quick judgment; note the skip briefly so it's visible, not silent. For a **standalone** task (no parent), this per-task review *is* the whole review — there's no story layer above it. Skipping the gate (beyond the trivial exception) is a defect.

### 8. Let the user review the diff — **before** committing

Once the behavior is validated and the per-task review is settled, **let the user review the diff first**. Don't commit on your own initiative; wait for the user's go-ahead on the actual changes.

### 9. Capture durable knowledge in the docs — before you close

Before committing, ask once: **did a decision, a standardization, or long-lived knowledge surface while building this card?** If so, **write or update the doc now** — an `adr` for a decision (with the _why_), the matching `guide`/`module` for a new or changed convention, a `module`/`note` for a durable gotcha. Prefer **updating** an existing doc over creating a second; **skip** the ephemeral or deducible (no doc spam). The full criterion lives in the **`claude-organizer`** skill (_Docs_). Docs live in the MCP, not in git, so this is independent of the commit below.

### 10. Commit, then attach the commit's diff to the card — **always**

- After the user confirms, create **one commit per card**, message in English referencing the key (e.g. `feat(tags): … (CO-4)`), per the repo's `CLAUDE.md` (commit + versioning rules).
- **Always attach the commit's diff** right after it lands with this skill's bundled `attach-commit` script (see _Diff-capture scripts — they ship inside this skill_). It runs `git show` and POSTs the diff to the API (`CO_API_URL`, default `http://127.0.0.1:4400`), so the card's **Changes** section shows what the commit produced. (Token only when auth is on — see _Auth flag for diff capture_.)
- The diff is captured **outside your context on purpose** — **never read it or paste it into a comment** (it burns tokens and adds noise).
- Attaching the real commit **clears the pending working-tree diff** automatically (the `__working__` sentinel row is dropped), so the card swaps from "uncommitted" to the committed diff with no manual cleanup on the happy path.

### 11. Move to `done` — **always**, only after the user confirms

**`set_card_status(id, "done")`** once the user has confirmed it works. Don't leave a validated card sitting in `review`, and never mark `done` before validation.

If this is the **last child of a story**, the **story-level review gate** fires **before** the story closes: an additional `review`-skill pass over the **whole story** (≈ one PR, `git diff <base>...HEAD`), scoped to what a single task can't see — the **story's acceptance criteria**, **duplication across tasks**, **coherence of the PR**; it does not re-review each task line-by-line (the per-task gates already did). Only then move the history to `done` too (see _History status_).

At this story boundary — and before advancing to the next card/story or ending the session — re-check the inbox **fresh**: call **`list_inbox` (pending)** again (don't trust the orientation snapshot — the user may have dropped demands while you worked). If it surfaces pending demands the work didn't cover, **stop and ask** whether to review/plan them now (a decision gate — they may **reshape the upcoming stories**). The criterion and wording live in the **`claude-organizer`** skill (_Inbox_).

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

## Reserving the card — advisory claim

The board coordinates parallel sessions/machines with an **advisory** claim: it signals "this card is in my work buffer" so another session doesn't start the same thing. Nothing is locked (the API never blocks on it); the skill is what respects it.

- **One session token per run.** At the start of a run, generate a single opaque `sessionToken` and a readable `label` — the user's name when you know it (auth on), otherwise a generic session label. **Reuse both** for every claim/release/take-over this run; don't mint a new one per card.
- **Claim when you pick a card up** (step 1): `claim_task(<key>, <sessionToken>, <label>)`. A **story** also reserves its not-yet-started (`todo`) children. Reserved cards show an hourglass on the board.
- **Conflict = held by another session.** `claim_task` returns `{ ok:false, conflict:true, claim }` **without changing anything**. **Stop and ask the user** — _"`<key>` is reserved by `<claim.ownerLabel>` since `<claim.claimedAt>`; take it over?"_ On **yes**, `take_over_task(<key>, <sessionToken>, <label>)` swaps the token to you; on **no**, don't start that card. **Take-over is always user-confirmed.**
- **Release.** Completing the card (`done`) **auto-releases** the claim. If you **abandon/cancel** a card without finishing, `release_task(<key>, <sessionToken>)`. A **CTRL-C keeps** the claim on purpose, so you can resume; resuming in a **new run** mints a new token, so your own earlier claim now reads as a conflict → the take-over prompt above retakes it.

## History status — keep it honest as children move

A **history** (a parent card with sub-tasks) is a container; its status tracks its children. The moment work starts on any child — you move the first sub-task to `in_progress`, or one is already `done` — move the history to `in_progress` too. Move it to `done` only when **every** child is `done`. The board shows each history's child counts, so an out-of-sync status is visible and confusing.

## The quick checklist

Per card, in order — no step skipped. **Standing rule: never assume — any ambiguity or decision the card doesn't settle goes to the user before you build; for a story, clear all of them up front.**

1. Re-read the board → `claim_task` (conflict → ask, then take-over) → `in_progress` (history too, if a sub-task).
2. `list_comments(cardId)` (read-only) — even if read before; `mark_comments_read` once you've addressed them.
3. Read the relevant docs.
4. Implement — clean code, no needless comments; hit a doubt → stop and ask; then self-review your own diff with fresh eyes before handing off (doesn't replace the gate).
5. Comment the signal.
6. `review` status + test-plan comment + `attach-worktree-diff` → wait for validation.
7. Per-task review gate (fresh subagent; skip only if trivial) → fixes fold in → re-run `attach-worktree-diff`.
8. Let the user review the diff.
9. Capture durable knowledge in the docs.
10. Commit (one per card, key in message) → `attach-commit`.
11. `done` after the user confirms — story's last child → story-level review gate first, then close the history; re-check the inbox fresh at the boundary.
