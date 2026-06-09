---
name: review
description: Use to REVIEW work in claude-organizer with fresh, objective eyes before it's closed — like a senior engineer reviewing a real PR. Two levels, both MANDATORY gates the `implement` skill fires — a per-task review when a task is done (its own diff), and a story-level review when a story's last child is done (the whole PR's cross-cutting concerns: duplication across tasks, coherence, story acceptance criteria). It verifies acceptance criteria are met the right way and hunts for real problems — bugs, security, DB/query and performance issues, outdated/deprecated/vulnerable dependencies, high complexity, missed reuse, unnecessary code and comments. It spawns a FRESH subagent for each pass, reports the findings, then asks what to do next (fix now / follow-up card / other). Trigger whenever a task just finished, a story's last task just finished, or the user asks to review a card/story/PR. Don't review in this context yourself, and don't auto-create cards. A trivial task (one-liner, rename, config) may skip its per-task review by quick judgment.
---

# Reviewing with fresh eyes

This skill is the **review phase** — what a careful **senior engineer reviewing a PR** does. The session that just wrote the code is the worst judge of it: it's anchored to the choices it made. So every review runs in a **separate subagent with a clean context**, which checks that the **acceptance criteria were actually met, the right way**, and goes looking for the **real problems a human reviewer would catch**: bugs and missed edge cases, security holes, slow or wasteful data access, risky dependencies, needless complexity, missed reuse, and code or comments that shouldn't be there.

<SKILL-GATE>
**Load the `claude-organizer` panorama first.** This skill assumes you are oriented on the board. If you have **not** already loaded the **`claude-organizer`** skill in this conversation, invoke it now (Skill tool) and run its start-of-session orientation **before** anything below. If it is already loaded in this conversation, don't reload it — just continue. Don't enter this skill cold.
</SKILL-GATE>

## The two levels — different scopes, so they don't redo each other's work

### Per-task review — local scope

Fires when a **task** is done, **before it closes**. Reviews **just that task's diff**:

- the **task's own acceptance criteria** — met / partial / not-met, with evidence;
- **reuse, dead code, and comments** *within that task's change*.

**A trivial task may skip it.** A one-liner, a rename, a config tweak, a pure copy move — nothing with real logic — isn't worth a subagent. Use quick judgment; when you skip, say so briefly (a short note/comment on the card) so the skip is visible, not silent. When in doubt, review.

### Story-level review — cross-cutting scope

Fires **once**, when a **story's last child task is done**, **before the story closes**. The per-task reviews already covered each task's internals, so this pass looks **only at what a single task can't see**:

- **the story's acceptance criteria** — the sum of the tasks *plus* what emerges from them together;
- **duplication across tasks** — two tasks that each grew a near-identical helper/component/type; logic that should have been shared;
- **coherence of the whole PR** — does the changeset hang together, or are there seams, leftovers, contradictions between tasks?

It does **not** re-review each task line-by-line — that's already done. Reviewing the same code twice wastes the pass.

### Standalone task

A task with **no parent** is its own unit (≈ its own PR). It gets a **single review at completion** — the per-task review *is* the whole review, since there's no story layer above it. (Trivial-skip still applies.)

<HARD-GATE>
Both gates are **mandatory** and the `implement` skill fires them automatically — they are **not** optional and **not** skippable because the work "looks fine" (trivial tasks are the only exception, and only at the per-task level). The point is exactly that the implementing session's confidence is unreliable; an independent pass catches what it's blind to. Run the gate **before** the unit closes (`done`). Skipping it is a defect.
</HARD-GATE>

> **On comments:** the `implement` skill already requires code to be written without needless comments from the start, so the reviewer treats comment noise as a **safety net** — flagging what slipped through, not running a cleanup the implementer should never have left for it.

## How — dispatch the `reviewer` agent

Do **not** review in this context. Spawn a **fresh subagent** per pass, starting from a clean slate.

**Use the dedicated `claude-organizer:reviewer` agent** (`Agent` tool, `subagent_type: "claude-organizer:reviewer"`). It is **read-only by construction** — its tool roster has no `Edit`/`Write` and no board-write MCP tools, so it physically **cannot** fix code or touch the board, only read code + git + the board and report. The full review **mandate** (scope discipline, the checks, the output format) lives in the **agent definition** — this skill doesn't restate it; it just hands the agent the scope and the changeset:

- **The card** — the **card id or key** (e.g. `CO-42`) **and the scope** (per-task / story / standalone). The agent pulls the card itself (`get_card` / `get_card_by_key` + `list_comments`; for a story, the parent **and all children**), so it has the acceptance criteria and constraints straight from the source.
- **The changeset spec** — how to see exactly the code in scope (it runs the git itself; don't paste diffs):
  - **per-task / standalone** → that task's commit (`git show <sha>`) or the working-tree diff of just its files (`git diff`).
  - **story** → the whole unit: the branch/PR diff against the base (`git diff <base>...HEAD`), or the commits referencing the story's key **and its children's keys**.

The agent returns a structured report — **Acceptance criteria** (met/partial/not-met per criterion, with evidence), **Findings** (typed, ordered by severity, with `file:line` + fix + severity), and a one-line **Verdict** — as data, not prose. It **finds and reports**; it does not fix and does not touch the board.

> If `subagent_type: "claude-organizer:reviewer"` isn't resolvable in this environment (agent not loaded), fall back to `general-purpose` and paste the mandate from `agents/reviewer.md` into the prompt — but prefer the named agent, so the read-only roster is enforced.

## After the subagent returns — report, then ask

1. **Report** to the user — acceptance-criteria verdict first (this is what the review is *for*), then the improvement findings, concise and grouped. Don't bury the lede: a not-met criterion or a high-severity finding goes up front.
2. **Ask what to do next — don't act on your own.** Present the options; **do not** auto-create cards and **do not** start fixing unprompted:
   - **fix now** — apply the changes before the unit closes (they fold into the same PR);
   - **follow-up card(s)** — capture findings as new cards (via the `plan`/board flow) for later;
   - **other** — defer, dismiss as won't-fix, accept as partial, etc.
3. **Act on the choice.** Fixes go back through the `implement` lifecycle; cards get created; then the unit can close.
4. **Re-review non-trivial fixes before closing.** A fix is itself a change, and a change can introduce new problems. If the fixes you applied were **substantial** — a new function, edits across several files, a reworked code path, anything with real logic — run **one more fresh review pass over the fix diff** before the unit closes. **Skip** the re-review for **obvious** fixes (deleting a comment, a lint/format tweak, a rename, a one-liner) — same trivial-skip judgment as a per-task review. The session that just applied the fix is the worst judge of it.

Record the outcome on the board: a short comment on the card with the criteria verdict and anything deferred, following the signal-vs-noise rule in the `claude-organizer` skill. The full finding list is ephemeral working material — never paste the whole diff or a wall of nitpicks into a comment.

## Where this sits

Planning (`plan`) → execution (`implement`) → **review (this skill)** → close. The `implement` skill fires the per-task gate as each task wraps up and the story gate when the last child finishes; this skill hands back once findings are reported and the user has chosen what to do, so the task/story can move to `done` and the PR can be merged.
