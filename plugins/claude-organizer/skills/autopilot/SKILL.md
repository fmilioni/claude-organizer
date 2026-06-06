---
name: autopilot
description: Use to run the board autonomously — let the AI advance through SEVERAL ready cards on its own, each as an independent PR off main, guided by the blocker graph, without stacked PRs. Trigger when the user says "run the board", "execute the board", "advance on your own", "knock out the ready tasks", "autopilot", or asks the AI to work multiple cards in one go. It maps the dependency graph, settles every ready card's open decisions with the user UP FRONT (so execution never guesses), asks sequential-vs-parallel, then runs each ready card through the `implement` lifecycle + `review` gate on its own branch, opens a PR, and STOPS when only PR-dependent or blocked work remains — never merging to main itself. To execute ONE specific card interactively, use `implement`; to plan a new demand, use `plan`.
---

# Running the board autonomously

This skill is the **board-level orchestrator**. Where `implement` walks **one** card through its lifecycle with the user validating each step, `autopilot` advances through **many** ready cards in one go — each as an **independent PR off `main`** — using the board's **blocker graph** to know what can run now and what must wait. The methodology is **trunk-based, dependency-aware**: no stacked PRs, no cascade rebases, no coupled merges.

It does not replace `implement` and `review` — it **drives** them per card. Its own job is the orchestration around them: the dependency graph, the up-front decision sweep, the two execution modes, and knowing when to stop.

<SKILL-GATE>
**Load the `claude-organizer` panorama first.** This skill assumes you are oriented on the board. If you have **not** already loaded the **`claude-organizer`** skill in this conversation, invoke it now (Skill tool) and run its start-of-session orientation **before** anything below. If it is already loaded in this conversation, don't reload it — just continue. Don't enter this skill cold.
</SKILL-GATE>

<HARD-GATE>
Four invariants hold for **every** card, in both modes. Breaking one is a defect, not an optimization:

1. **Never stack.** A branch only ever starts from an up-to-date `main`. You do **not** start a card whose blocker isn't **merged into `main`** yet (not merely `done`/PR-open — see _Detecting "merged into main"_).
2. **The AI never merges to `main`.** In autonomous mode the AI commits **on the branch** and opens a **PR**; the **user's merge is the confirmation gate**. Nothing reaches `main` without the user.
3. **No card executes with an open decision.** Every ready card is made **100% decided with the user before execution** (Phase 2). A subagent that hits an unforeseen doubt **stops and reports** — it never guesses (see _Parallel mode_).
4. **Respect the graph.** The ready set is recomputed from the live board each round; you work only what's genuinely unblocked.
</HARD-GATE>

## Pick the mode first — ask the user

Before anything else, ask which mode (one question, `AskUserQuestion`):

- **Sequential ("one at a time")** — independent ready cards, one after another, in the **main session**. Skills load normally (Skill tool). Each card gets its own branch + PR off `main`. Simpler to follow; lower throughput.
- **Parallel ("all at once, in worktrees")** — independent ready cards simultaneously, **one subagent (`Agent` tool) per card**, each in its own **git worktree** off `main`. Higher throughput; needs the conflict guard and inline skill-loading below.

Recommend **sequential** unless the user wants throughput and the ready set is large and clearly non-overlapping.

## The loop — one round, repeated

A round runs Phases 1→4. After the user merges some PRs, a new round recomputes the ready set and unblocks dependents. Repeat until the board has no ready work left.

### Phase 1 — Map the board, build the ready set

- Read the live board (`list_cards` for the active sprint **and** sprint-less board cards; `get_card` for detail). Build the **dependency graph** from **blockers** (`blockedBy`/`blocking`) and story→children links.
- `git fetch origin` so `main` is current, then compute the **ready set**: cards in a board status (`todo`) that are **not** blocked by anything **not yet merged into `main`** (see _Detecting "merged into main"_). A story's children are the executable units; the story is a container.
- Exclude anything already `in_progress`/`review`/`done` and anything `blocked`.

### Phase 2 — Decide the ready set up front (pre-flight)

This is the guard that makes autonomous execution safe: **execution must never guess.** Apply the shared decision doctrine in **`../../shared/deciding.md`** (relative to this skill's base directory) — but at **board scope and in a batch**, over the **current ready set only** (dependents get their own sweep in a later round, once they unlock — deciding them now risks deciding stale).

- For each ready card, read its **description + comments** and gather **every** open decision/ambiguity. Pool them across the whole ready set.
- Surface them to the user as a batch — still **one topic per message**, **chained**, ready-made options with trade-offs and a recommendation (the doctrine). Research where you can't offer good options from knowledge alone.
- **Record each answer back into the card** so a fresh executor (you next, or a subagent) reads a card that's already settled: a **comment** always, and the **description** when the answer changes the spec. This is what lets a subagent "just execute".
- A card that still has an unresolved decision after the sweep does **not** enter execution this round — it waits (note why).

### Phase 3 — Execute the ready set

Run each fully-decided ready card through the **normal `implement` lifecycle + `review` gate**, with the autonomous commit/merge rule (below). The only thing that changes per mode is *who* runs the card and *where*:

- **Sequential:** in the main session, one card at a time — for each, branch from fresh `main` → `implement` lifecycle → per-task `review` gate → commit on the branch → open the PR (`gh`) → set the card to `review` → next independent card.
- **Parallel:** one subagent per card, each in its own worktree — see _Parallel mode_.

Each card is a **fresh branch off the up-to-date `main`** (`git fetch origin && git switch -c <branch> origin/main`), never off another card's branch. One PR per card. Keep `pnpm attach-commit <sha>` per card after its commit. **Claim each card as it enters execution** so another machine doesn't take the same work (see _Reserving cards across machines_).

**Record the PR on the card when you open it** — post the PR number/link as a comment. Your context may reset between rounds, and the next round's Phase 1 needs to map a card back to its PR (to check merge state and to report what's waiting). The card status alone (`review`) doesn't carry the PR number.

### Phase 4 — Report, then stop or loop

Before stopping or looping, re-check the inbox **fresh** (`list_inbox`, pending) — demands dropped mid-round won't be in the orientation snapshot this round started from. If pending demands not covered by this round remain, surface them to the user as a decision gate (they may **reshape the next round's ready set** or need planning via `plan`), instead of silently looping past them.

**Stop** when the ready set is empty — only PR-dependent or blocked work remains — **or** when a card carries a decision the user must settle that wasn't cleared in Phase 2. Then **report**, concisely:

- **PRs opened** this round (card key → PR link/branch).
- **Waiting on your merge** — which cards unblock once you merge which PRs.
- **Blocked** — what's still waiting on unmerged work, and on what.

**Resume** when the user merges: a new round (Phase 1) recomputes the ready set against the updated `main`, and the dependents that were waiting become ready.

## Sequential mode

Straightforward: the main session is the executor, so skills load normally and `implement`/`review` drive each card exactly as usual. The only autopilot-specific rules are the **HARD-GATE invariants**, the **fresh-branch-per-card** discipline, and the **stop/report** behavior. If a card surfaces a decision Phase 2 missed, handle it inline with the user (you're in the main session) and record it, then continue.

## Parallel mode

One subagent (`Agent` tool, `subagent_type: "general-purpose"`) per ready card, each in its own **git worktree** off `main`, running concurrently.

### Subagents don't inherit skills — embed them inline

A subagent does **not** load this session's skills and can't be relied on to invoke the Skill tool. So the orchestrator **assembles each subagent's prompt inline** — paste, as text:

- the **relevant `claude-organizer`** orientation (board/comments/docs conventions, signal-vs-noise for comments);
- the **`implement` lifecycle** (the steps it must walk) and the **`review` gate** — the executor runs the per-task review by spawning the dedicated **`claude-organizer:card-reviewer`** agent (read-only by construction; the mandate lives in the agent, so it needn't be embedded), or returns its own diff for the orchestrator to review — decide per run;
- the **decision doctrine** from `../../shared/deciding.md`, **with the override that the subagent must NOT ask the user** (point 3 below);
- the **full card** — description **and comments** (already decided in Phase 2);
- the relevant **`CLAUDE.md` overrides** (commit message format, versioning, import/gotcha rules);
- the **base branch** and the **worktree path** it must work in.

Read the canonical files at runtime and concatenate them — don't paraphrase from memory, so the subagent gets the current text. (Sentinel note: the Skill-tool/sentinel path covers the **main session**; for **subagents** the mechanism is this **inline** embed, not the Skill tool.)

### The three parallel-mode rules

1. **Worktree isolation.** Each agent works in its own `git worktree` created off the fresh `main` (`git worktree add <path> -b <branch> origin/main`). It implements → review gate → commit on its branch → opens its PR → returns the result (PR/branch + any findings) to the orchestrator, which consolidates and reports. Remove the worktree when done.
2. **Conflict guard — serialize would-be collisions.** Before dispatching, infer each ready card's likely **touched area** from its tags (`web`/`api`/`mcp`/…) and the files/modules named in its description. If two ready cards likely touch the **same files/area**, do **not** run them in parallel — run them **sequentially** (in blocker order if there is one) so their PRs don't fight at merge time. Only genuinely disjoint cards run together.
3. **A subagent NEVER asks the user.** It can't reach them. If it hits an unforeseen ambiguity/decision the card doesn't settle, it **stops that card and returns the open question** to the orchestrator (it does not guess, and does not pick a "probably intended" reading). The orchestrator surfaces it to the user (Phase 2 doctrine), records the answer on the card, and **re-dispatches** that card. This preserves the never-assume guarantee where interactive asking isn't possible.

## Detecting "merged into main"

A blocker being `done` is **not** enough — its PR may still be open. The robust check, after `git fetch origin`:

- If the blocker card carries a **commit** (its `commits[].sha`), it's in `main` when that sha is an **ancestor of `origin/main`**: `git merge-base --is-ancestor <sha> origin/main` (exit 0 = merged).
- If the blocker carries **no code** (a pure decision/planning card with no commit), `done` is enough — there's nothing to merge.
- Fallback when ancestry is inconclusive: the PR's merged state via `gh pr view <n> --json state,mergedAt`. When still unsure, treat it as **not merged** (safe: you never stack).

## Commit / merge rule in autonomous mode

The project rule "commit only after the user confirms" **adapts** here, it isn't broken:

- In autonomous mode the AI commits **on the branch** and opens a **PR**; the **user's merge is the confirmation point**. The AI **never merges to `main`** — the user's review of the PR is the gate (HARD-GATE 2).
- Per-card discipline is unchanged otherwise: one commit per card, message in English referencing the key, then `pnpm attach-commit <sha>`. Move the card to `review` when its PR is open and awaiting the user; to `done` only after the user merges (a later round can reconcile statuses against merged PRs).
- This is the **autonomous path**; the card-by-card validated path in `implement` (user confirms behavior before each commit) still governs when you're executing a single card interactively.

**What changes in the `implement` lifecycle on the autonomous path** (only these — the rest is unchanged): the user isn't present per card, so the **wait for behavioral validation** (step 6) and the **user's diff review before commit** (step 8) are replaced by **the PR itself** — committing on the branch and opening the PR *is* the handoff, and the user validates by reviewing/merging the PR. The per-task **`review` gate still runs before the commit** (over the working-tree diff), and the **test-plan still gets posted** — as the PR body and/or a card comment — so the user knows how to validate. Ordering: run the review gate → commit → open PR → `attach-commit` → set the card to `review` (PR open = ball in the user's court).

## Reserving cards across machines (advisory claim)

The run coordinates with other sessions/machines through the **advisory** claim (full semantics in `implement`'s _Reserving the card_). At board scope:

- **One session token + label for the whole run** (the orchestrator's), reused across every card and — in parallel mode — handed to each subagent so its `done` auto-releases under the same identity.
- **Claim each card as it enters execution** (Phase 3): `claim_task(<key>, <token>, <label>)` on the fresh branch; a story claim cascades to its `todo` children. In **parallel mode the orchestrator claims before dispatching** the subagent, so the conflict check happens centrally — a card already held by **another** session is **not** dispatched.
- **A conflict is a Phase-2-style decision, not a guess.** If a ready card is held by another session/machine, **surface it to the user** (_"reserved by X since Y — take over?"_) like any open decision; on confirmation, `take_over_task`; otherwise skip that card this round. Never auto-take.
- **Release** is automatic on `done`; a normally abandoned/skipped card gets `release_task`. A crash **keeps** the claim — the next round's claim attempt reads it as a conflict and the take-over prompt retakes it.

## The one-line checklist

1. **Ask the mode** — sequential or parallel.
2. **Map** the board → dependency graph → **ready set** (`git fetch`; blockers must be **merged into `main`**, not just `done`).
3. **Decide** the ready set up front with the user (shared doctrine, batch, current ready set only) → **record answers into the cards**.
4. **Execute** each decided card on a **fresh branch off `main`** → **`claim_task`** (conflict → ask, take-over) → `implement` lifecycle → `review` gate → commit on branch → open PR → `attach-commit` → card to `review`. Parallel: one subagent per card in a worktree, skills **inline**, conflict guard on, **subagent never asks**.
5. **Never** stack, **never** merge to `main` yourself.
6. **Report** (PRs opened / waiting on your merge / blocked) and **stop** when only PR-dependent or blocked work remains. Re-check the inbox **fresh** before stopping/looping and gate pending demands with the user. **Resume** after the user merges.
