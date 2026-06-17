---
name: implement
description: Use to EXECUTE cards that already exist on the board in claude-organizer — a task, a story, several stories, or a whole sprint. Trigger the moment you start, resume, or continue work on specific cards ("work CO-42", "implement this story", "run the sprint", "build it now"). Owns the per-card lifecycle (in_progress → implement → review by a fresh subagent → review status → commit) and multi-card runs in two modes — review each card, or run the whole batch autonomously. Commits one per card (after the user approves the review, or directly in an agreed batch run); leaves each card in `review` until the user approves. NEVER assume — any open decision the card doesn't settle goes to the user first. To break a NEW demand into cards, use `plan` instead.
---

# Implementing a card

Execute a card that already exists on the board — a task, a story, or a sprint's cards. Planning produced the card; here you build it and walk it through its lifecycle while keeping the board honest. To break a new demand into cards, use **`plan`** — not this skill.

> **Load the `claude-organizer` skill first.** If it hasn't been loaded in this conversation, invoke it (Skill tool) before anything below — it covers what the board is, the project binding, and the comment/doc conventions this skill relies on. If it's already loaded, just continue.

**Hard rule:** the per-card lifecycle below runs **every card, in order** — trivial or not. Never assume past an open decision; never move a card to `done` without the user's explicit approval. Leaving a card in `review` is the correct resting state, not a defect.

## Never assume — ask the user

Execution constantly hits things the card didn't nail down. **Never guess past one — ask**, before writing code:

- **Ambiguity → a direct question.** **Decision** (more than one defensible path: which helper/library, data shape, where code lives, edge-case behavior) **→ ready-made options** with trade-offs, the recommended one first and labeled `(Recommended)` / `(Recomendado)` in the user's language. Use `AskUserQuestion`, one topic per message; chain unknowns (settle the earlier, it narrows the next).
- **Check first** — the answer may already be in the card's description, its comments, or the docs; don't re-litigate a settled call. **Record** the answer as a comment (and fold it into the description when it changes the spec).
- **A story is decided up front.** Before building a story, read all its cards (description + comments), gather every open decision across them, and clear the batch with the user before any code.

## Running multiple cards — a story, several cards, or a sprint

When the user points you at more than one card (a whole story, several cards or stories, a sprint), settle two things up front, then loop the lifecycle per card:

1. **Ask the run mode** (`AskUserQuestion`, before any code):
   - **Review each card** — stop after each card for the user to validate before the next (commit waits for approval per card; the one-card-at-a-time path in the lifecycle).
   - **Run it all at once (batch)** — execute every card autonomously, leaving each in `review`, and validate the whole batch at the end (commit directly per card).
2. **Agree the git flow** for the run — unless `CLAUDE.md` already defines one (then follow it, don't ask). In batch mode the options matter most: one PR for everything, straight commits, or a stack of branches (see _Git flow_).
3. **Track the run with a tasklist** (`TaskCreate` / `TaskUpdate`) mirroring the cards in execution order — in **both** modes, so you and the user always see where the run is. Update each item as its card moves (`in_progress` → `review` → `done`).
4. **Loop the lifecycle** per card, in order; respect blockers (don't start a card whose blocker isn't `done`). The **story-level review fires in both modes** (see the lifecycle).

## Git flow — agree before you start

Get the git flow straight **before writing code**. If the repo's `CLAUDE.md` already defines one, follow it — don't ask. Otherwise **ask** (ready-made options + a recommendation), scaled to the run:

- **A single card** → its own branch (branch + PR) **or** commits straight on the current branch / `main` / `master`.
- **A story, several stories, or a sprint** → **one branch + one PR for the whole run**, **straight commits** on the current branch / `main` / `master`, or a **stack of branches** (one per card or per story).

Mirror what the user already does; factor in parallel work / worktrees for scopes worked in parallel. **The agreed flow is your standing authorization to commit** (see the lifecycle).

**Worktree?** Use `.claude/worktrees/<branch>` (fixed path — don't ask where). First ensure `.claude/worktrees/` is in `.gitignore`; after creating it, install the project's deps (a fresh worktree has none) before any typecheck/lint/build; remove it (`git worktree remove`) when done.

## The lifecycle — every card, in order

1. **`in_progress` + claim.** Re-read the current board first (priorities/comments may have changed). `set_card_status(id, "in_progress")` before a line of code, and `claim_task(<key>, <sessionToken>, <label>)` to reserve it (`label` = the user's full name from auth / `git config user.name`; one token reused all run). **Starting a story:** claim **all** its children (signals the whole story is being worked) but move **only the current child** to `in_progress`; move the parent story to `in_progress` too — each child's claim is then released individually as that child is committed (step 8). A claim **conflict** (held by another session) → stop and ask before `take_over_task`.
2. **Read this card's comments** — `list_comments(cardId)`, every card, even if read before (new context may have landed). Reading advances `unread → read`; once you've **acted** on a comment, `mark_comments_handled([...])`. A story's comments don't cover its children — read each.
3. **Read the relevant docs** — `list_docs` / `search_docs`, then read what bears on this card's area (the `module` you'll touch, an `adr`/`note` that constrains it). Docs are the project's memory — read them so your work keeps the established decisions and patterns consistent. **Docs are the source of truth:** if your change would **contradict a documented decision (an ADR) or convention**, don't diverge silently — either comply, or raise **superseding that doc** with the user (a conscious spec change) before building.
4. **Implement** — clean code, no needless comments (comment only a non-obvious *why*, a subtle invariant, a workaround, or a public API). Stay in scope. Open any image the card carries (`ReadMcpResource attachment://<id>`) before building — a markdown link isn't "seen". Hit a doubt → stop and ask (step _Never assume_). Then **self-review your own diff** with fresh eyes (acceptance criteria, YAGNI, naming, that checks exercise behavior) and fix the easy misses inline — this doesn't replace the review gate.
5. **Comment the signal** — `add_comment` for decisions+why, scope changes, deviations, edge cases. Skip noise (the plan, narration, "typecheck passed").
6. **Review gate — a fresh subagent** (see _Dispatching the reviewer_). Run it over the working-tree diff so fixes fold into one clean commit. **Fix every in-scope finding** — severity ranks the list, it never authorizes dropping one. A finding **too big for this card** (spans other modules/systems) → `create_inbox` it and flag it in the final overview, don't silently drop it. Re-review non-trivial fixes.
7. **Hand off to `review`.** `set_card_status(id, "review")` and post **one** test-plan comment (what to open, do, expect; what you already checked). **Keep the claim** — the card's work isn't locked in until it's committed, so it's released at step 8, not here.
8. **Commit, then release — timing depends on the run mode:**
   - **Review-each-card mode (and any single card):** **do not commit until the user approves the review.** Attach the **working-tree** diff (`attach-worktree-diff <CO-N>`) so the card in `review` shows the pending change; wait for the user's go-ahead, then commit **one per card** (message in English with the key, e.g. `feat(tags): … (CO-4)`) + `attach-commit <sha>` (replaces the preview), **release the claim** (`release_task(<key>, <sessionToken>)`), and move the card to `done` (or open a PR — see _End of run_).
   - **Batch mode (run-it-all-at-once):** the agreed git flow is your authorization — commit each card **before starting the next** (so its working-tree diff stays isolated for that card's review gate), **one per card**, + `attach-commit <sha>`, then **release the claim** (`release_task(<key>, <sessionToken>)`), leave the card in `review`, update the tasklist, and **continue to the next**. The whole batch is approved together at the end of the run.
   - **Auth on:** each attach needs its **own** token, so the review-each-card path mints **two** (`issue_commit_token(<key>)` for `attach-worktree-diff`, then a fresh one for `attach-commit`); batch mints one per card. See _Diff capture_.

When a **story's last child** reaches `review` — **in both modes** — run one extra reviewer pass over the **whole story** for cross-cutting issues a single task can't see (duplication across tasks, PR coherence) before the story is considered ready. Changeset: **batch mode** has every child committed → `git diff <base>...HEAD`; **review-each-card mode** still has the last child uncommitted → `git diff <base>` so the working tree is included. Keep the **history status** honest: `in_progress` once any child starts, `done` only when every child is done.

## Dispatching the reviewer

Spawn the **`claude-organizer:reviewer`** agent (`Agent` tool) — it's read-only by construction (no board tools, no Edit/Write), so it reads code + git and reports; **you** dispose of its findings. You have board access, so curate into its prompt everything it needs:

- **The card** — description and **acceptance criteria**, the **scope** (per-task / story / standalone), and the **relevant comments** (the decisions/constraints that bear on the review — you filter junk from signal). For a story, inline the parent + all children.
- **The changeset spec** — how to see exactly the in-scope code (it runs git itself): per-task → that task's working-tree diff (`git diff`) or commit (`git show <sha>`); story → `git diff <base>...HEAD`.
- **Relevant docs and image refs** — inline the pertinent docs; for images pass the MCP server name + `attachment://<id>`.

It returns a structured report (acceptance criteria met/partial/not-met, typed findings by severity, a verdict). Fix the in-scope findings; surface to the user anything that's a real trade-off or too big for the card; nothing is dropped on severity.

## End of run

After the cards are built and sitting in `review`:

1. **Overview** — what landed, and **especially** the out-of-scope items pushed to the inbox, so nothing gets lost.
2. **Docs** — the moment a **durable decision** was made (more than one defensible path, affects the build beyond one card — **including a decision the user settled mid-run**), a **convention** emerged or changed, or **long-lived module knowledge** surfaced, create/update the doc: an `adr` (Context · Decision · Consequences, with the *why*) / `guide` / `module` / `note`. **Module-doc coverage:** if you **created or materially changed a code area that has no `module` doc**, write/update its module doc so the system's spec stays complete. Prefer updating an existing doc over a duplicate; reference docs as `[Doc title](/docs?doc=<id>)`. (Per-card decisions are already recorded as comments via _Never assume_ — this is the durable, cross-cutting layer on top.)
3. **Close by the git flow used.** For any card still awaiting approval (a batch run leaves them all in `review`), wait for the user's affirmative ("approved", "you can merge", "go ahead", "continue"), then: committed straight on the current branch / `main` → move the approved cards to `done`; committed on a branch → offer to open a **PR** (one PR for a single run branch, or one per branch for a stack; title a conventional-commit with the key, body in English; merging is the user's call — see `CLAUDE.md`). Until the user approves, cards stay in `review`.
4. **Close the tasklist** — mark each item done as its card lands, so the final state is visible.
5. **Re-check `list_inbox` (pending) fresh** — the user may have dropped demands while you worked. If any aren't covered, suggest planning them (they can open a fresh session for clean context on a big run).

## Diff capture

Two scripts ship **inside this skill** — call them by absolute path under this skill's directory (the `pnpm` shortcuts exist **only** in the claude-organizer dev repo). Use the `.mjs` on any host with Node 18+; a `.py` twin sits next to each for hosts without Node. Both POST the diff to the API outside your context — **never read or paste the diff**.

- **`attach-worktree-diff.mjs <CO-N>`** — the **review preview before any commit**: attaches the working-tree diff so the user sees the pending change while the card sits in `review`. The card key is **required** (there's no commit to read it from). Used in the one-card-at-a-time path, where the commit waits for approval.
- **`attach-commit.mjs <sha> [CO-N]`** — after a commit lands: attaches the clean per-card commit diff (replaces any worktree preview). The commit **`<sha>` is required**; the card key is **optional** — the script parses it from the commit message (`… (CO-N)`), so pass `[CO-N]` only if the message doesn't carry it. Used the moment you commit — directly in a batch run, or after approval in the one-card path.

```bash
# card key is the CO-N key (e.g. CO-42); sha is the commit hash you just created
node "<this skill's directory>/scripts/attach-worktree-diff.mjs" CO-42
node "<this skill's directory>/scripts/attach-commit.mjs" <sha>
# auth on → prefix the same command with the card-scoped token:
CO_COMMIT_TOKEN=<token> node "<this skill's directory>/scripts/attach-commit.mjs" <sha>
```

**Auth flag** — read it from the project's `CLAUDE.md`. Auth **on** → mint `issue_commit_token(<CO-N>)` and pass `CO_COMMIT_TOKEN=<token>` (one per attach). Auth **off / no flag** → run tokenless. If an attach returns **401**, auth is actually on: record the flag in `CLAUDE.md`, then retry with a token.
