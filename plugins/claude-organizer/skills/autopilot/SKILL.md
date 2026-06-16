---
name: autopilot
description: Use to run the claude-organizer board AUTONOMOUSLY — a whole sprint, a story, or a set of cards hands-off ("autopilot", "run the sprint by yourself", "just work the board", "run the cards without me babysitting"). A LEAN orchestrator dispatches a fresh subagent per card (implementer → reviewer → fixes) so a long run never degrades, STOPS to ask the user on every new decision, commits one-per-card on the agreed target (a run branch, or straight on the current branch), and leaves each card in `review` (never `done`) for the user's final validation — by default it does NOT open a PR or merge. To plan a fuzzy demand use `plan`; to execute ONE card interactively use `implement`. Trigger only when the user explicitly opts into an autonomous multi-card run.
---

# Autopilot — running the board autonomously

This skill runs **many cards in one go** without the main session degrading. The session you are in becomes a **lean orchestrator**: it manages the run and talks to the user, but it does **not** read code or implement anything itself — every heavy piece of work happens in a **fresh subagent** whose context dies with it, so the orchestrator only ever holds small structured results, never the accumulated implementation context.

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
- **The subagents carry NO board (claude-organizer MCP) tools — on purpose.** An agent's `tools:` allowlist is pinned to one MCP prefix, which **silently** breaks if the board was registered under a different prefix (the agent gets zero board tools, no error). So instead of pinning, the implementer and reviewer have **no** board access at all: **you** — the orchestrator, whose main session reaches the board however it's registered — read the board, **curate** the card + the comment info and docs that matter into each dispatch prompt, and perform **every** board write the subagent's result asks for (its returned signal comments, docs, plus all status moves). This makes autopilot **registration-agnostic** — it runs against whatever board your session is pointed at.

## The run, end to end

### A. Scope the run

Decide what the run covers — **ask the user if it isn't obvious**:

- **Active sprint** (default) — all of its not-`done` cards.
- **A story** — that parent and its children.
- **A set of cards** — an explicit list the user named.

Order is always by the **blocking graph**: a card is **ready** when every blocker is in `review` or `done` — `review` counts as satisfied, so a run flows through a dependency chain without anything reaching `done`. **Run cards one at a time, in series** — parallelism is out of scope for now.

### B. Agree the git flow, then open any branch(es)

Before opening anything, **don't impose a methodology**. If the repo's `CLAUDE.md` already defines a git flow, **follow it — don't ask**. Otherwise, **confirm the git flow with the user explicitly** (the never-assume method: concrete options + a recommendation). First judge whether the run's cards form **one coherent theme** or **scopes too distinct to share a single PR** (e.g. "login system" and "PDF export" have nothing to do with each other) — judge by area/tags/story themes, it's judgment, not a rigid rule. Then offer how to work:

- **One coherent scope** (the common case) → **one branch for the whole run** (e.g. `autopilot/<sprint-or-topic>`, one commit per card onto it) **or**, if the user prefers, **commits straight onto the current branch / `main` / `master`** (still one commit per card). Don't default to a branch silently — offer both.
- **Distinct scopes** → **stop and ask** how to split, with worked options + a recommendation (the never-assume method): **one PR** (everything on one branch — when the coupling justifies it); **stacked PRs** (one branch atop another — when the scopes depend in sequence); **separate PRs off `main`** (build one, return to `main`, build the next — when they're independent); or **separate worktrees** (one per scope/story — when the user wants them in parallel / distinct sessions; the orchestrator itself still runs one series, the worktrees being a hand-off for the user to drive separately). Recommend the split that best fits the coupling you detected.

Either way you do **not** open a PR and do **not** merge here — that's the run's close (section G), only on the user's say-so; the run otherwise ends on the branch(es) for the user to validate.

**Worktrees — one standard location, always cleaned up.** When a strategy uses a worktree (or any session needs to isolate work), put it at **`.claude/worktrees/<branch>`** — don't ask where each time, and don't scatter them in `../<name>`. Three steps, in order: **(1)** before `git worktree add`, ensure `.claude/worktrees/` is in `.gitignore` (add it if missing) — a **prerequisite**, since a worktree inside the repo otherwise shows up as untracked, committable content the moment it's created; **(2)** after creating it, make sure the worktree's dependencies are in place before any typecheck/lint/build/test — a fresh worktree starts **without the project's installed dependencies**; verify they resolve and, if they don't, install them the way the project already installs (use the project's install command), or those checks break; **(3)** remove the worktree once it's no longer needed — typically once its PR is open, and certainly after a merge: `git worktree remove`. Never leave an orphaned worktree behind.

### C. Claim the entire scope up front

Before any work, `claim_task` **every story and card the run will touch**, using one `sessionToken` + `label` for the whole run (reuse them for every claim/release/take-over). **The `label` is the user's full name** (e.g. `Felipe Milioni`) — never just the first name, never the email. Source it from the **auth identity when auth is on**, otherwise from `git config user.name`; if no name resolves at all, fall back to a **generic session label** (e.g. `session <short-token>`). Keep the run-context suffix on top of that name, in the form `<Full Name> (autopilot <KEY>)` — the standardization fixes only the **name** part, it doesn't drop the suffix. Claiming a **story cascades** to its `todo` children, so claiming the stories usually covers it; claim any standalone cards too. The cascade covers **only `todo`** children — a child already in another status (a mid-run resume, or a scope that includes work already started) must be claimed/taken-over **individually**. This closes the window where another session grabs a card this run already planned to do. A **conflict** (held by another session) → **stop and ask** the user before `take_over_task`.

### D. Gather every decision first — top-down, chained

Before writing a single line, walk the scope's cards **in execution order** and surface **every** open decision and ambiguity — but **chained, not as a flat batch**. Resolve the questions of the first card, then **carry those answers into the next**: an answer in card A routinely **creates, changes, or eliminates** a question in card B, so always reconsider later cards in light of what's already settled. One topic per message, ready-made options with trade-offs and a recommendation (the never-assume method below). **Record each answer** as a comment on its card (and fold it into the description when it changes the spec) so the implementer reads a card that's already decided. Nothing starts until this is clear.

### E. The per-card loop

For each ready card, in series:

1. **Mark `in_progress`, then dispatch the implementer.** First `set_card_status(<id>, "in_progress")` — the claim is **advisory and does not move status**, so the orchestrator owns this transition; a card must never jump `todo`→`review` without passing through `in_progress`. Then **curate the dispatch context** (the agent has no board tools, so this is its only input): read the card and its comments, and pass in the prompt the **full card** (description + acceptance criteria — the core), the **comment info that actually bears on the build** (a comment can be junk or a decisive constraint; you filter and send just what matters), the **relevant docs** (only the pertinent slice, not the tree), the **run context** (the branch, settled decisions), and — if the card carries images — the MCP **server name** + `attachment://<id>` refs. Then spawn the **`claude-organizer:implementer`** agent (`Agent` tool, `subagent_type: "claude-organizer:implementer"`) — the agent form of the `implement` skill, mirroring `reviewer`. Its mandate (invoke `implement` in runner mode, build only, never commit/spawn/ask/move-status, never touch the board, return the structured contract) is baked into the agent. It edits the working tree and returns one of the runner-mode contract results (below). **You don't read its diff** — you act on its return.
2. **Handle the return** (comment read-state transitions here follow the "Comment read-state" note in the Comments section — reading a thread advances `unread → read`, and `mark_comments_handled` once the run acts on a comment):
   - **`needs_decision`** → take it to the user (`AskUserQuestion`): the decision, the worked options, your recommendation. **Record the answer as a comment** on the card (and the story when it matters). Then **re-dispatch the implementer** with the answer. (Default policy is **stop and ask** — never decide a card's open question silently.)
   - **`blocked`** → record why as a comment, leave the card as-is (don't force it), and move on to the next ready card; note it for the final summary.
   - **`ready_for_review`** → proceed to review. The return may carry `comments` (signal the agent would have posted) and `docs` (durable knowledge it surfaced, as content) — the agent has no board access, so **you** record them at step 6.
3. **Dispatch the reviewer** — spawn the **`claude-organizer:reviewer`** agent (a sibling subagent, read-only, **no board tools**) over the card's working-tree diff, per-task scope. Curate its context the same way as the implementer (E.1), plus the **changeset spec** (it runs the git itself). It returns an acceptance-criteria verdict + findings. (Don't review in the orchestrator yourself.) **This per-card review is mandatory — never skipped.** Every card that reaches `ready_for_review` gets a reviewer dispatch before it commits; there is no "looks fine" shortcut, even on cards that seem trivial — the trivial-skip judgment applies **only** to *re-reviewing a fix* (step 4), never to this first review.
4. **Fix loop** — for findings that **fit the card's scope**, dispatch the **`claude-organizer:implementer`** agent again in **fix mode** (pass it the findings to apply — a fix is just another runner-mode build); then **re-review** with a fresh reviewer **unless the fix was trivial** (a one-liner / rename / comment deletion — same trivial-skip judgment the `review` skill uses). Repeat until no in-scope findings remain.
   - **Severity is not a filter — it's an order.** `low` findings get fixed like any other; "no in-scope findings remain" means **none left**, not "none above `low`". You do **not** get to decide a finding "isn't worth a cycle" and commit past it — you are the orchestrator that drove the build, so that veto is exactly the writing-session bias the fresh reviewer exists to defeat. An in-scope finding leaves the card only by being **fixed** or by being **too big** (next bullet) — never by being deemed too minor.
   - A finding that is **too big to fix now** — it spans **many files, many systems, or a module unrelated to what this card touches** — is **not forced**. Record it in the **inbox** (`create_inbox`) as a demand to plan later, **and** add it to the run's **decision/findings ledger** for the final summary. Never silently drop it.
5. **Commit** — on the agreed target (the run branch, or straight onto the current branch / `main` / `master` per section B), **one commit per card**, message in English referencing the key (e.g. `feat(scope): … (CO-N)`), then attach the diff with the bundled `attach-commit` script (mint `issue_commit_token(<CO-N>)` when auth is on — see the `implement` skill's _Auth flag_ / _Diff-capture scripts_ sections for the exact invocation; this skill reuses those bundled scripts).
6. **Move the card to `review`** (never `done` — final validation is the user's) and `release_task` — the commit and its diff attach already happened in step 5, so this step is the status move plus the board writes the agent couldn't do: the **test-plan comment** the implementer returned in `ready_for_review.testPlan`, any **signal `comments`** it returned, and any **durable knowledge** it surfaced (`docs`) — for each, decide whether it updates an existing doc or creates a new one (search the docs first) before `write_doc` — so the user knows how to validate and the run's signal/knowledge actually lands on the board. When any of these (a comment, a test plan, a doc body) references another doc, link it as `[Doc title](/docs?doc=<id>)`, never a bare id or a plain-text title (see the **`claude-organizer`** skill, _Reference a doc as a link_).
7. **Story boundary** — when a card is the **last child** of its story to reach `review`, dispatch a **story-level review** (reviewer agent, story scope: the whole branch diff, cross-cutting concerns) and **re-check the inbox fresh** (`list_inbox` pending) — a demand may have landed mid-run that reshapes what's left; if so, stop and ask the user.

### F. End of the run — the self-auditing summary

Stop where the agreed flow lands (the run branch, or the current branch): N commits, every card in `review`, nothing merged. Then write a **complete, self-auditing summary** for the user that lists **explicitly**:

- **(a) Every decision the user made** during the run, and what each settled.
- **(b) Every review finding that was NOT fixed** — each with why (deferred / too-big), and the too-big ones pointing at the **inbox items** you created. **"It was only `low`" is not a valid why.**
- The cards now in `review` (with keys) and any `blocked` cards left behind.

This summary exists to **expose what was left behind, not hide it** — the known failure mode is quietly ignoring a finding and not fixing it. If the fix loop did its job, list (b) is short and every entry has a reason. Keep a running ledger as you go so nothing is lost by the end.

### G. Closing the run — PR, merge, and the move to `done` (only when the user asks)

The run **stops at `review` by default** (section F): no PR, no merge, the cards wait for the user. A card leaves `review` for `done` **only on an affirmative signal from the user** — and any affirmative counts: "approved", "you can merge", "go ahead", "close them". The user often continues with exactly that — *"open the PR and merge it"* — and that hand-off has a tail the autopilot has dropped before: **after that go-ahead, the cards it covers must move from `review` to `done`.** Forgetting it is the known failure mode.

When the user gives that go-ahead (typically: open a PR and/or merge):

1. **Open the PR / merge by the repo's governance.** Follow the git/merge rules the repo's `CLAUDE.md` defines (branch protection, who may override, the exact merge command). **Don't invent an override** (`--admin` and the like) on your own initiative — that's the user's explicit, per-merge call, per the repo's rules. With distinct scopes (section B), this is one PR per branch.
2. **After the merge confirms, move every merged card `review` → `done`.** The user's instruction to merge/approve **is** the affirmative signal that authorizes the move — so do **not** re-ask card by card. `set_card_status(<id>, "done")` for each card that landed in the merge; closing a `done` card also auto-releases its claim.
3. **Don't skip the gates the close implies.** If a story's **story-level review** never ran (its last child only reached `review` at run's end), run it before closing that story; move each **history** to `done` only once all its children are `done`; and **re-check the inbox fresh** (`list_inbox` pending) at the boundary, surfacing anything the run didn't cover.

<HARD-GATE>
**After the user approves a merge, the cards it covers do not stay in `review`.** Moving every merged card to `done` is mandatory — it is the step this skill has dropped before. But the trigger is the **user's affirmative signal** (the merge/approval request), never the merge mechanics on their own: absent any word from the user, the run **stays at `review`** (the default-stop, section F), and a card never reaches `done` on the orchestrator's own initiative. The instant the user takes you through a merge, `done` is owed on every card that merged (and the histories they complete). Never end a user-approved merge with a merged card still sitting in `review`.
</HARD-GATE>

## The run TODO — a Claude Code checklist that mirrors the run

Keep a **`TodoWrite`** checklist in sync with the run so the user watches it advance in real time. It's the orchestrator's job (part of keeping the board honest), never a subagent's.

- **Build it once the scope and order are settled** — after the claim (C) and the chained decisions (D), with the ready order coming from the blocking graph. **One item per card** — *not* a separate implement/review item per card — plus **one dedicated item per story-level review**, slotted in execution order right after that story's last card. Example: `CO-1`, `CO-2`, `CO-3`, `review story A`, `CO-4`, `CO-5`, `review story B`.
- **Status mirrors the work:** flip a card's item to `in_progress` when you dispatch its implementer (step E.1) and to `completed` when the card reaches `review` (step E.6); flip a story-review item to `in_progress` at the story boundary (step E.7) and to `completed` once that review and its fixes are done.
- A `blocked` card's item stays open (not `completed`) — the final summary (F) is what accounts for it.
- **When the user opts into the close (section G), add a final `close the run` item** — PR/merge → move every merged card to `done` → worktree cleanup — so the move-to-`done` stays visibly tracked, not forgotten.

## The runner-mode return contract — must match `implement`

The implementer's final message is structured data you consume (keep this in exact sync with the _Runner mode_ section of the `implement` skill):

- `{ status: "needs_decision", decision, options, recommendation }` — an unsettled choice; take it to the user, then re-dispatch.
- `{ status: "ready_for_review", summary, files, testPlan, comments, docs }` — built and self-reviewed; `summary` = what changed and why, `files` = touched paths, `testPlan` = how to validate (you post it as the card's test-plan comment on the `review` move), `comments` = signal to post on the card, `docs` = durable knowledge the agent surfaced, as content (what + why + area) — **you** `write_doc` it (step 6). Both optional.
- `{ status: "blocked", reason }` — cannot proceed.

## Comments — signal only

Comment on **task and story** cards, but only with **signal** (the same discipline as the `claude-organizer` skill): **what was decided for the user and why**, deviations from what the card asked, what was deferred or pushed to the inbox. Never narrate the plan or write what's deducible from the card's state. Noise on a dozen cards is a dozen times the noise.

**Comment read-state — the orchestrator owns it (the subagents have no board tools).** Comments carry the three-state AI read-status (`unread → read → handled`). Reading a card's thread via `list_comments(cardId)` over MCP **advances its `unread` user comments to `read`** — and now **only the orchestrator** reads threads (to curate each dispatch's context). But `read` is not the end-state — **a comment the run acted on must be marked `handled`** via `mark_comments_handled([...commentIds])`: when the user answers a decision and you fold it in, when the implementer's build addresses a card's feedback, when a finding is resolved. **Never leave a comment the run dealt with stuck in `read`** — that's the unhandled queue lying about what's actually been done. The session-start scan `list_unhandled_comments(projectId)` returns `unread` + `read` and **advances** the comments it returns `unread → read` (never to `handled`), so anything left in `read` resurfaces until handled.

## Never assume — the orchestrator is the only voice to the user

Autopilot does **not** lower the never-assume bar — it **centralizes** it. A subagent can't ask, so every unsettled decision flows back to you, and **you** ask the user with ready-made options + a recommendation (recommended option first, marked in its label, in the user's language), one topic per message. Default behavior on any new decision is **stop and ask** — proceeding on a guess is a defect, and worse here because it compounds unattended across many cards.

## Resilience — a run survives interruption

Claims persist on purpose (a CTRL-C keeps them). A resumed autopilot **re-orients from the board**: cards in `in_progress` or claimed under the run's token are the resume points; cards already in `review` are done from the run's perspective. Resuming in a new run mints a new token, so the earlier claims read as conflicts → the user-confirmed `take_over_task` retakes them. Never blindly restart work a prior run already moved to `review`.

## The shape in one line

scope → **git strategy** (one PR / stacked / separate off `main` / worktrees / straight commits) → branch(es) if any → claim all → chained decisions → build run TODO → **per card:** implementer (runner-mode) → decision? ask + record → reviewer → fix-loop (too-big → inbox) → commit on branch → `review` + release → **story end:** story review + inbox recheck → **run end:** self-auditing summary (default-stop at `review`, no PR/merge) → **user asks to merge:** PR/merge per repo governance → **move merged cards to `done`** + worktree cleanup.
