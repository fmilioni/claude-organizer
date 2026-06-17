---
name: claude-organizer
description: Entry point for a project tracked in claude-organizer (the `mcp__claude-organizer__*` tools). Explains what the board is, routes to the right phase skill, and records the project binding in CLAUDE.md so future sessions start without listing projects. Read this to know WHICH skill to use; the actual workflow lives in that skill.
---

# claude-organizer

claude-organizer is a "Jira for Claude Code" exposed over MCP: a project's **cards** (tasks), **sprints**, **backlog**, **comments** and **docs**. It is the source of truth for what to work on and why — not your memory. A fresh session starts blank; this is how continuity survives across sessions.

This skill only tells you **which skill to use** and **how to find the project**. The real workflow lives in the phase skills below — switch to one instead of working from memory.

## The skills — pick by what the user asks

- **`plan`** — a **new demand** (feature, change, fix) to break into work. Turns it into sprints/stories/tasks. **All card creation goes through here** — never `create_card` ad-hoc.
- **`implement`** — **execute a card that already exists** (a task, a story, or a sprint's cards). Owns the per-card lifecycle and fires a fresh-subagent review before each card is committed.

## Find the project — binding first, `list_projects` only if missing

Every tool takes an explicit `projectId`. Get it without scanning:

1. **Check `CLAUDE.md` / `CLAUDE.local.md`** for the board binding (`projectId`, `keyPrefix`, `slug`, auth flag). If it's there, use the `projectId` directly — **don't call `list_projects`**.
2. **Only if no binding exists**, call `list_projects`, match the project whose `slug` fits this repo, then **write the binding** (next section). If none matches, ask the user before creating one.

**Multiple hosts:** you may have more than one organizer host connected at once — each is a **separate MCP server** with its own tool prefix and its own projects. Run the lookup on the **right server** (the one whose project `slug` matches this repo) and never mix hosts in a single operation; if unsure which host a repo belongs to, ask.

## Record the binding so the next session starts direct

When you had to discover the project (no binding found), persist it so it never needs discovery again. Write a stanza with: **`slug`**, **`keyPrefix`** (cards are `<KEY>-N`), **`projectId`**, and the **auth (diff-capture) flag**.

- **Which file:** solo/private repo → `CLAUDE.md` (committed). Open-source or multi-board repo (committing *your* board id is wrong) → `CLAUDE.local.md` (gitignored). When ambiguous, ask.

## Auth flag — record ON the first time an attach fails

The diff-capture scripts (run by `implement` — `attach-commit` / `attach-worktree-diff`) post a card's diff to the API. If one fails with a **401 (authorization)**, this deployment has auth **ON**: the scripts need a card-scoped token (`issue_commit_token(<KEY-N>)` minted and passed as `CO_COMMIT_TOKEN`; mechanics live in `implement`). **Set `auth: ON` in the binding** the first time you hit this, so future sessions pass the token up front instead of failing.
