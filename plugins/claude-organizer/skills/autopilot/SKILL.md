---
name: autopilot
description: Use to run the claude-organizer board AUTONOMOUSLY — work a whole sprint, a story, or a set of cards hands-off ("autopilot", "run the sprint by yourself", "just work the board", "run the cards without me babysitting"). A LEAN orchestrator in the main session dispatches a fresh subagent per card (implementer → reviewer → fixes) so a giant run never degrades the main context, claims the whole scope up front, gathers every open decision before any code, STOPS and asks the user on every new decision (and records it), commits one-per-card on a single run branch, and leaves each card in `review` (never `done`) for the user's final validation. It does NOT open a PR or merge. To plan a fuzzy demand into cards use `plan`; to execute ONE card interactively use `implement`. Trigger only when the user explicitly opts into an autonomous multi-card run.
---

# Autopilot — running the board autonomously

This skill runs **many cards in one go** without the main session degrading. The session you are in becomes a **lean orchestrator**: it manages the run and talks to the user, but it does **not** read code or implement anything itself — every heavy piece of work happens in a **fresh subagent** whose context dies with it. That is the whole point: a sprint-long run that would delirium a single context stays sharp because the orchestrator only ever holds small structured results, never the accumulated implementation context.

<SKILL-GATE>
**Load the `claude-organizer` panorama first.** This skill assumes you are oriented on the board. If you have **not** already loaded the **`claude-organizer`** skill in this conversation, invoke it now (Skill tool) and run its start-of-session orientation **before** anything below. If it is already loaded in this conversation, don't reload it — just continue. Don't enter this skill cold.
</SKILL-GATE>

<HARD-GATE>
**You are the orchestrator. You do not write code, read diffs, or implement cards.** The instant you are tempted to open a file or fix something yourself, stop — that is a subagent's job. Your context must stay lean for the whole run. You **dispatch**, you **decide with the user**, you **commit**, you **keep the board honest**. Everything else is delegated. Breaking this defeats the skill.
</HARD-GATE>

## Why the design is shaped this way — three hard constraints

These are facts about Claude Code subagents; the whole flow follows from them:

- **A subagent can invoke plugin skills.** So an implementer subagent can run `claude-organizer:implement`, and a reviewer can run the review pass. This is what makes delegation possible at all.
- **A subagent CANNOT spawn another subagent.** So the implementer cannot fire the review gate (which is itself a subagent). **You** — the orchestrator, the main session — spawn the implementer and the reviewer as **siblings**, never nested. This is exactly why `implement` has a **runner mode** that skips its own review-spawn and commit.
- **A subagent CANNOT talk to the user** (`AskUserQuestion` is unavailable to it). So **all** user interaction is centralized in you. A subagent that hits a decision **returns** it; you take it to the user. This is what makes "stop and ask on every decision" both possible and mandatory.

## The run, end to end

### A. Scope the run

Decide what the run covers — **ask the user if it isn't obvious**:

- **Active sprint** (default) — all of its not-`done` cards.
- **A story** — that parent and its children.
- **A set of cards** — an explicit list the user named.

Order is always by the **blocking graph**: a card is **ready** when every blocker is in `review` or `done` (CO-325 made `review` count as satisfied — that's what lets a run flow through a dependency chain without anything reaching `done`). **Run cards one at a time, in series** — parallelism is out of scope for now.

### B. Open the run branch

Confirm the git flow with the user, then create **one branch for the whole run** (e.g. `autopilot/<sprint-or-topic>`). Every card commits onto this single branch — one commit per card. You do **not** open a PR and do **not** merge; the run ends on the branch and the user splits it into PRs and validates as they see fit.

### C. Claim the entire scope up front

Before any work, `claim_task` **every story and card the run will touch**, using one `sessionToken` + `label` for the whole run (reuse them for every claim/release/take-over). Claiming a **story cascades** to its `todo` children, so claiming the stories usually covers it; claim any standalone cards too. The cascade covers **only `todo`** children — a child already in another status (a mid-run resume, or a scope that includes work already started) must be claimed/taken-over **individually**. This closes the window where another session grabs a card this run already planned to do. A **conflict** (held by another session) → **stop and ask** the user before `take_over_task`.

### D. Gather every decision first — top-down, chained

Before writing a single line, walk the scope's cards **in execution order** and surface **every** open decision and ambiguity — but **chained, not as a flat batch**. Resolve the questions of the first card, then **carry those answers into the next**: an answer in card A routinely **creates, changes, or eliminates** a question in card B, so always reconsider later cards in light of what's already settled. One topic per message, ready-made options with trade-offs and a recommendation (the never-assume method below). **Record each answer** as a comment on its card (and fold it into the description when it changes the spec) so the implementer reads a card that's already decided. Nothing starts until this is clear.

### E. The per-card loop

For each ready card, in series:

1. **Mark `in_progress`, then dispatch the implementer.** First `set_card_status(<id>, "in_progress")` — the claim is **advisory and does not move status**, so the orchestrator owns this transition; a card must never jump `todo`→`review` without passing through `in_progress`. Then spawn the **`claude-organizer:implementer`** agent (`Agent` tool, `subagent_type: "claude-organizer:implementer"`) — the agent form of the `implement` skill, mirroring `reviewer`. Its mandate (invoke `implement` in runner mode, build only, never commit/spawn/ask/move-status, return the structured contract) is baked into the agent, so just pass it the **card key** and any run context (the branch, settled decisions). It edits the working tree and returns one of the runner-mode contract results (below). **You don't read its diff** — you act on its return.
2. **Handle the return:**
   - **`needs_decision`** → take it to the user (`AskUserQuestion`): the decision, the worked options, your recommendation. **Record the answer as a comment** on the card (and the story when it matters). Then **re-dispatch the implementer** with the answer. (Default policy is **stop and ask** — never decide a card's open question silently.)
   - **`blocked`** → record why as a comment, leave the card as-is (don't force it), and move on to the next ready card; note it for the final summary.
   - **`ready_for_review`** → proceed to review.
3. **Dispatch the reviewer** — spawn the **`claude-organizer:reviewer`** agent (a sibling subagent, read-only) over the card's working-tree diff, per-task scope. It returns acceptance-criteria verdict + findings. (Don't review in the orchestrator yourself.)
4. **Fix loop** — for findings that **fit the card's scope**, dispatch the **`claude-organizer:implementer`** agent again in **fix mode** (pass it the findings to apply — a fix is just another runner-mode build); then **re-review** with a fresh reviewer **unless the fix was trivial** (a one-liner / rename / comment deletion — same trivial-skip judgment the `review` skill uses). Repeat until no in-scope findings remain.
   - A finding that is **too big to fix now** — it spans **many files, many systems, or a module unrelated to what this card touches** — is **not forced**. Record it in the **inbox** (`create_inbox`) as a demand to plan later, **and** add it to the run's **decision/findings ledger** for the final summary. Never silently drop it.
5. **Commit** — on the run branch, **one commit per card**, message in English referencing the key (e.g. `feat(scope): … (CO-N)`), then attach the diff with the bundled `attach-commit` script (mint `issue_commit_token(<CO-N>)` when auth is on — see the `implement` skill's _Auth flag_ / _Diff-capture scripts_ sections for the exact invocation; this skill reuses those bundled scripts).
6. **Move the card to `review`** (never `done` — final validation is the user's) and `release_task` — the commit and its diff attach already happened in step 5, so this step is just the status move plus the **test-plan comment** the implementer returned in `ready_for_review.testPlan`, so the user knows how to validate.
7. **Story boundary** — when a card is the **last child** of its story to reach `review`, dispatch a **story-level review** (reviewer agent, story scope: the whole branch diff, cross-cutting concerns) and **re-check the inbox fresh** (`list_inbox` pending) — a demand may have landed mid-run that reshapes what's left; if so, stop and ask the user.

### F. End of the run — the self-auditing summary

Stop on the branch: N commits, every card in `review`, nothing merged. Then write a **complete, self-auditing summary** for the user that lists **explicitly**:

- **(a) Every decision the user made** during the run, and what each settled.
- **(b) Every review finding that was NOT fixed** — each with why (deferred / too-big), and the too-big ones pointing at the **inbox items** you created.
- The cards now in `review` (with keys) and any `blocked` cards left behind.

This summary exists to **expose what was left behind, not hide it** — the known failure mode is quietly ignoring a finding and not fixing it. If the fix loop did its job, list (b) is short and every entry has a reason. Keep a running ledger as you go so nothing is lost by the end.

## The runner-mode return contract — must match `implement`

The implementer's final message is structured data you consume (keep this in exact sync with the _Runner mode_ section of the `implement` skill):

- `{ status: "needs_decision", decision, options, recommendation }` — an unsettled choice; take it to the user, then re-dispatch.
- `{ status: "ready_for_review", summary, files, testPlan }` — built and self-reviewed; `summary` = what changed and why, `files` = touched paths, `testPlan` = how to validate (you post it as the card's test-plan comment on the `review` move).
- `{ status: "blocked", reason }` — cannot proceed.

## Comments — signal only

Comment on **task and story** cards, but only with **signal** (the same discipline as the `claude-organizer` skill): **what was decided for the user and why**, deviations from what the card asked, what was deferred or pushed to the inbox. Never narrate the plan or write what's deducible from the card's state. Noise on a dozen cards is a dozen times the noise.

## Never assume — the orchestrator is the only voice to the user

Autopilot does **not** lower the never-assume bar — it **centralizes** it. A subagent can't ask, so every unsettled decision flows back to you, and **you** ask the user with ready-made options + a recommendation (recommended option first, marked in its label, in the user's language), one topic per message. Default behavior on any new decision is **stop and ask** — proceeding on a guess is a defect, and worse here because it compounds unattended across many cards.

## Resilience — a run survives interruption

Claims persist on purpose (a CTRL-C keeps them). A resumed autopilot **re-orients from the board**: cards in `in_progress` or claimed under the run's token are the resume points; cards already in `review` are done from the run's perspective. Resuming in a new run mints a new token, so the earlier claims read as conflicts → the user-confirmed `take_over_task` retakes them. Never blindly restart work a prior run already moved to `review`.

## The shape in one line

scope → run branch → claim all → chained decisions → **per card:** implementer (runner-mode) → decision? ask + record → reviewer → fix-loop (too-big → inbox) → commit on branch → `review` + release → **story end:** story review + inbox recheck → **run end:** self-auditing summary, no PR/merge.
