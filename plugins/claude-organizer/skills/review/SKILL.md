---
name: review
description: Use to REVIEW work in claude-organizer with fresh, objective eyes before it closes — like a senior engineer on a real PR. Two MANDATORY gates the `implement` skill fires: a per-task review when a task finishes (its own diff), and a story-level review when a story's last child finishes (cross-cutting concerns a single task can't see). Each pass runs in a FRESH subagent that verifies the acceptance criteria were met the right way and hunts the real problems a reviewer catches — bugs, security, performance, risky deps, complexity, missed reuse, dead code — then disposes of EVERY finding, never dropping one on severity. Trigger when a task or a story's last task just finished, or the user asks to review a card/story/PR. Don't review in this context yourself, and don't auto-create cards. Only a no-logic change may skip its per-task review (and the skip is recorded on the card).
---

# Reviewing with fresh eyes

This skill is the **review phase** — what a careful **senior engineer reviewing a PR** does. The session that just wrote the code is the worst judge of it: it's anchored to the choices it made. So every review runs in a **separate subagent with a clean context**, which checks that the **acceptance criteria were actually met, the right way**, and goes looking for the **real problems a human reviewer would catch**: bugs and missed edge cases, security holes, slow or wasteful data access, risky dependencies, needless complexity, missed reuse, and code or comments that shouldn't be there.

<SKILL-GATE>
**Load the `claude-organizer` panorama first.** This skill assumes you are oriented on the board. If you have **not** already loaded the **`claude-organizer`** skill in this conversation, invoke it now (Skill tool) and run its start-of-session orientation **before** anything below. If it is already loaded in this conversation, don't reload it — just continue. Don't enter this skill cold.
</SKILL-GATE>

## The two levels — when each gate fires, and what changeset it gets

The internal **scope mechanics** of each pass (what's in/out of scope, the don't-re-review-twice rule) live in the `reviewer` agent definition; here is only what the dispatcher needs to fire the right gate over the right changeset.

### Per-task review — local scope

Fires when a **task** is done, **before it closes**. Changeset: **just that task's diff**.

**Only a no-logic change may skip it.** A one-liner, a rename, a config tweak, a pure copy move — nothing with real logic — isn't worth a subagent. **Anything with real logic is reviewed, every time** — "it looks fine" is never a reason to skip (that confidence is exactly what the gate tests). When you do skip a no-logic change, **record the skip and its reason as a comment on the card** so it's visible and auditable. When in doubt, review.

### Story-level review — cross-cutting scope

Fires **once**, when a **story's last child task is done**, **before the story closes**. Changeset: **the whole story** (parent + all children), so the pass can see what a single task can't.

### Standalone task

A task with **no parent** is its own unit (≈ its own PR). It gets a **single review at completion** — the per-task review *is* the whole review, since there's no story layer above it. (The no-logic skip from per-task still applies — and even then the skip is recorded on the card.)

<HARD-GATE>
Both gates are **mandatory** and the `implement` skill fires them automatically before the unit closes (`done`); the only exception is a **no-logic change** at the per-task level (skip recorded on the card). Skipping a gate is a defect.
</HARD-GATE>

## How — dispatch the `reviewer` agent

Do **not** review in this context. Spawn a **fresh subagent** per pass, starting from a clean slate.

**Use the dedicated `claude-organizer:reviewer` agent** (`Agent` tool, `subagent_type: "claude-organizer:reviewer"`). It is **read-only by construction** — it has **no board (claude-organizer MCP) tools at all** and no `Edit`/`Write`, so it physically **cannot** fix code or touch the board; it reads code + git and the board context you hand it, then reports. The full review **mandate** (scope discipline, the checks, the output format) lives in the **agent definition** — this skill doesn't restate it; you dispatch from a context that *has* board access (the main `implement` session, or the autopilot orchestrator), so **you read the card and curate what the agent needs into its prompt**:

- **The card content** — its description and **acceptance criteria**, **the scope** (per-task / story / standalone), and the **relevant comments** (the constraints/decisions that bear on the review — a comment can be junk or decisive; you filter). For a **story**, inline the **parent and all children** (content + relevant comments). The reviewer has no board tools, so this is its only source for the criteria — pass it straight from the board you just read.
- **The changeset spec** — how to see exactly the code in scope (it runs the git itself; don't paste diffs):
  - **per-task / standalone** → that task's commit (`git show <sha>`) or the working-tree diff of just its files (`git diff`).
  - **story** → the whole unit: the branch/PR diff against the base (`git diff <base>...HEAD`), or the commits referencing the story's key **and its children's keys**.
- **Relevant docs and image refs** — inline the project docs pertinent to the area, and for any image attachment pass the MCP **server name** + `attachment://<id>` refs (the agent opens them with `ReadMcpResourceTool`).

The agent returns a structured report — **Acceptance criteria** (met/partial/not-met per criterion, with evidence), **Findings** (typed, ordered by severity, with `file:line` + fix + severity), and a one-line **Verdict** — as data, not prose. It **finds and reports**; it does not fix and does not touch the board.

> If `subagent_type: "claude-organizer:reviewer"` isn't resolvable in this environment (agent not loaded), fall back to `general-purpose` and paste the mandate from `agents/reviewer.md` into the prompt — but prefer the named agent, so the read-only roster is enforced.

## After the subagent returns — report, then dispose of every finding

<HARD-GATE>
The report is **input for a disposition that is the user's call, not yours** (the fresh-subagent rationale from the intro is exactly why). **Every finding is either fixed or surfaced — none is silently dropped, and severity never authorizes a drop.** `low` *ranks* a finding (do the high ones first); it does **not** delete it. Deciding a finding isn't worth it and committing past it is a **defect**, the same class as skipping the gate.
</HARD-GATE>

1. **Report** to the user — acceptance-criteria verdict first (this is what the review is *for*), then the findings, concise and grouped. Don't bury the lede: a not-met criterion or a high-severity finding goes up front. Report the **low** ones too — they're in the list, not filtered out.
2. **Dispose of each finding — route it, never bin it.** Two paths, and **every** finding takes one of them:
   - **Cheap, in-scope, unambiguous improvement** (a leftover comment, a missed reuse, dead code, a small rename, a tidier shape) → **just fix it.** This is the one disposition you may do without asking — the user still reviews it in the diff at the next lifecycle step, so it adds oversight rather than bypassing it.
   - **Everything else** — a real **trade-off**, a finding the **reviewer itself recommends keeping**, a naming/contract call, or anything **too big for this card** (spans many files/systems or a module this card doesn't touch) → **surface it to the user with a recommendation** (options + a recommended marker, same bar as a decision) and let the user dispose: **fix now** / **follow-up card** (via the `plan`/board flow) / **inbox** for later / **dismiss with a stated reason**. Relay the reviewer's own rationale when it recommended keeping. **Don't auto-create cards** — propose, the user chooses.
3. **Act on the choice.** Fixes go back through the `implement` lifecycle; follow-up cards/inbox items get created once the user says so; then the unit can close.
4. **Re-review non-trivial fixes before closing.** A fix is itself a change that can introduce new problems. If the fixes you applied were **substantial** — a new function, edits across several files, a reworked code path, anything with real logic — run **one more fresh review pass over the fix diff** before the unit closes. **Skip** the re-review for **obvious** fixes (deleting a comment, a lint/format tweak, a rename, a one-liner) — same trivial-skip judgment as a per-task review.

Record the outcome on the board: a short comment on the card with the criteria verdict and anything deferred, following the signal-vs-noise rule in the `claude-organizer` skill. The full finding list is ephemeral working material — never paste the whole diff or a wall of nitpicks into a comment.

## Where this sits

Planning (`plan`) → execution (`implement`) → **review (this skill)** → close. The `implement` skill fires the per-task gate as each task wraps up and the story gate when the last child finishes; this skill hands back once every finding is disposed — the cheap in-scope ones fixed, the rest decided by the user — so the task/story can move to `done` and the PR can be merged.
