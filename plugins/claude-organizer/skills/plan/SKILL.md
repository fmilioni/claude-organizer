---
name: plan
description: Use to turn a NEW fuzzy demand — a feature, a change, a fix — into structured work in claude-organizer (sprints, histories/stories, tasks). Trigger whenever the user describes something new to build (a feature, a change, a fix) before it's broken down, asks to plan/organize the work, or asks to CREATE A CARD (or several) — card creation always runs through this skill, never a direct create_card call. Even a single obvious card goes through here. Understands the demand, organizes it, gets the design approved, then creates the cards. This is PLANNING, not execution — do NOT write code here.
---

# Planning a demand into sprints, histories and tasks

Turn an idea into well-formed work through collaborative dialogue, then materialize it as **cards in claude-organizer**. The artifact is the **cards in the MCP** — not a spec file. Execution happens afterwards via the **`implement`** skill, card by card, with the user validating.

<SKILL-GATE>
**Load the `claude-organizer` panorama first.** This skill assumes you are oriented on the board. If you have **not** already loaded the **`claude-organizer`** skill in this conversation, invoke it now (Skill tool) and run its start-of-session orientation **before** anything below. If it is already loaded in this conversation, don't reload it — just continue. Don't enter this skill cold.
</SKILL-GATE>

<HARD-GATE>
Do NOT write code, scaffold, edit files, or take any implementation action until you have presented the organization (the plan) and the user has approved it. This applies to EVERY demand regardless of perceived simplicity — "too simple to plan" is exactly where wrong assumptions get baked in. The plan can be short, but you MUST present it and get approval.
</HARD-GATE>

## Flow

1. **Orient.** Read the current state first: `list_projects` → `get_active_sprint` → `list_unread_comments` → `list_cards` (and, when planning the **inbox**, `list_inbox` for the pending demands you'll convert). Then scan the **docs tree** (Modules / Decisions / Notes) and read what's relevant to the demand's area — a past decision or a note can change the design, and modules tell you how the area already works. Don't read everything; glance and decide. Know what exists before proposing anything.
2. **Understand & surface decisions.** Two kinds of unknowns block a well-formed card; resolve both _with the user_ before creating anything (the method is the shared doctrine in **`../../shared/deciding.md`** — read it):
   - **Ambiguities** — what the user actually wants: goal, scope, constraints, edge cases, what "done" looks like.
   - **Decisions** — open choices with more than one reasonable path (runtime/language, which API or library, auth model, session strategy, storage…). Never pick one silently — surface each as **ready-made options** the user chooses from.
   - **Likely gaps (suggest complements)** — assume the description may be **incomplete**: points the user wanted but didn't think to state. Map the probable gaps and downstream consequences and **offer them as suggestions** to accept or drop. Keep the framing **general** — don't invent concrete specifics the user didn't raise (that biases the plan). The **decision is always the user's**: you suggest, you never decide for them.
   - **From the inbox** — when the demand(s) come from `list_inbox` (pending), treat **each demand as raw input** to this step: one may become a single task, a story, or several cards. The never-assume rule is unchanged.

   **One topic per message**; prefer multiple-choice (open-ended is fine for ambiguities). Keep going until nothing remains that would materially change what gets built. It's far cheaper to ask now than to bake a wrong assumption into a card executed blindly later.
3. **Organize (propose).** Decide the shape of the work and present it with your reasoning (see _Where the work lives_):
   - **single task** — one coherent, testable deliverable. May live on the board with no sprint (a standalone task) or sit in the backlog for later.
   - **history (story) + tasks** — a cohesive feature split into a few testable deliverables.
   - **sprint + histories + tasks** — a large, cohesive effort worth isolating.

   **Before materializing a new demand, check whether it folds into a card that hasn't started.** Sweep the existing `todo`/`backlog` cards for **deliverable overlap**: if the new demand only extends or adjusts one of those **not-yet-started** cards, **propose updating that card** (scope/description/acceptance) and referencing the origin, instead of stacking a separate "fix" card on top of work that never began — the `update_card` runs in step 5, after approval. **Limit:** this holds only while the card is in `todo` or `backlog`; from `in_progress` onward the card is locked, so the new demand becomes **its own card**. If it isn't clearly the same deliverable, ask the user (never assume). _Example:_ the user asks for "dark mode", then later "detect the system theme" — both serve the same deliverable, so if the dark-mode card is still in `todo`/`backlog`, fold the second demand into it; if it has already left `todo`, open a new card.
4. **Get approval.** Present the proposed structure (and, when useful, 2–3 approaches with a recommendation). Revise until the user approves. Only then create anything.
5. **Create in the MCP.** Materialize the approved structure: `create_sprint` (if needed) → histories (cards) → tasks (cards, with `parentId` for a history's children). Create cards in **dependency order** — a task before the ones that depend on it — so a card you need to reference already has its key. Wire dependencies with blockers when one task must precede another. **Tag every task you create** (see the tagging rule in the `claude-organizer` skill): attach the tags that fit; if none fit, suggest new tag(s) and ask the user before creating them.
   - **Tasks live only as cards — never as a list in prose.** A history's `descriptionMd` describes the _history_: its goal, scope and decisions. It does **not** enumerate its tasks. The tasks ARE the child cards (`parentId`), and the board already shows them nested under the history. Re-listing them in the body creates a second, drifting copy and invites positional references like `CO-46.1` ("task 1 of the history") instead of the card's real key.
   - **No manual numbering in task titles.** Name each task by its **content alone** — never a positional prefix (`T1`, `T1.1`, `T2.3`, `H3 ·`). The board already numbers and groups tasks under their story (parent/child); a manual index duplicates that, reads cluttered, and drifts the moment order changes.
   - **Cross-reference by the card's real key.** When one card points at another — a dependency, a follow-up, "the foundation task" — use the key the MCP assigned (e.g. `CO-51`), which auto-links. Never invent a positional alias (`CO-46.1`, "task 1"): it links to nothing and breaks the moment order or scope changes. Write each key in full — `CO-53, CO-54`, not a shorthand range like `CO-53/54` (only the first half links). This is exactly why you create in dependency order — so the real key exists when you write the reference.
   - **Don't use `priority` to order the board.** Order is fixed by the reorder pass (step 7), which writes each card's `position`. `priority` (0–10) means **urgency/importance**, not sequence — set it only when a card genuinely carries more urgency. (Board order is `position` ASC, then `priority` DESC as a tiebreak.)
6. **Review what you created.** Once the cards exist, do a verification pass before handing off — light for a single task, **mandatory and thorough when the scope is large** (multiple sprints, dozens of cards), because breadth is where a card comes out thin and drift goes unnoticed. Read **card by card**:
   - **Pending decisions** — did any open choice slip through unsettled? Surface it, then fold the answer into the card.
   - **Completeness** — is each card self-sufficient (the memoryless-session test in _Writing a task_), or did something come out half-written under the volume?
   - **Order** — settle the intended top-to-bottom **execution/reading order** now; it gets written to the board in step 7.
   - **Coherence & objective** — step back to the whole: do the cards fit together (dependency order, no gap or contradiction), and does the set actually achieve the objective the user set? Fix what doesn't — adjust, split, merge or drop cards — and tell the user what you changed.
7. **Order the board (reorder).** Once the set of cards and their sequence are final, call **`reorder_cards`** once with **every created card id in reading order**; it writes `position = 0,1,2,…` so the board shows the cards top-to-bottom in execution order, independent of how or when each was created.
   - **Reading order, grouped by story:** each story (parent card) immediately followed by its children in execution order, then the next story; standalone cards slotted at their right point. The board renders the parent as an envelope and ranks each story block by the **lowest `position` among its children**, so monotonic positions in reading order place every block correctly (the parent's own `position` is harmless — still pass its id).
   - Worth running even for a single batch of standalone tasks — one call that makes the order explicit instead of leaning on the creation-time fallback.
8. **Close the inbox loop (when planning from the inbox).** Once the cards exist and are ordered, call **`mark_inbox_planned(id, cardKeys[])`** for **each converted demand**, passing the **real keys** of the cards it produced (one demand may map to several keys; auto-linked in the web). A demand the user **discarded** — it became no card — is **not** marked planned; instead **drop it yourself**, asking the user whether to **archive** it (`archive_inbox` — recoverable, the suggested default) or **destroy** it (`destroy_inbox` — gone for good). Don't leave a discarded demand pending "for the user to handle from the web".
9. **Re-check the inbox before handing off.** New demands can land **while you plan** — the user captures something after your step-1 orientation. So before the hand-off, re-run **`list_inbox`** (pending) and compare it against what this session planned (and, when planning from the inbox, the demands you marked in step 8). If a pending demand is left that this plan didn't cover, **surface it and offer to plan it now** — a single offer, don't nag. Applies to every planning flow, not only inbox-driven ones.
10. **Hand off.** Tell the user the plan is on the board; execution proceeds via the **`implement`** skill, card by card (`in_progress` → read comments → implement → review → commit → done), with the user validating each card, and the **`review`** skill's gate (per-task + story-level) before work closes.

## Surfacing decisions, not assuming them

A demand almost always hides choices with more than one defensible answer. The wrong move — and the easy one — is to silently pick one and bake it into a card; that's a decision made _for_ the user instead of _by_ them. Surface it. This holds even for demands that look trivial: "too simple to have decisions" is exactly where a silent assumption slips in.

The method — ready-made options with trade-offs and a recommendation, one topic per message, chaining (settle the earlier choice first because it narrows the next), research when you can't offer good options from knowledge alone — is the shared doctrine in **`../../shared/deciding.md`**. Read it and apply it. Example chain: "get the current temperature" hides *how to access it* (Node/Python/shell) then *which weather API* (free tier, accuracy, rate limits); "build an auth system" hides OAuth-or-not, identity providers, session as token or cookie, hashing algorithm, and so on.

**What's specific to planning: these are the decisions that shape the _card_ — the _what_, not the _how_.** Stop at the choices needed to write a well-formed card, and fold each answer into the card before creating it (a decision that lives only in chat is lost). The implementation may surface further decisions later; those belong to execution (the `implement` skill), not here. Don't drift into designing the code.

## Granularity — Scrum, adapted for full-IA execution

This is executed **full-IA with the user's review and validation**. Think in real Scrum terms, adapted to "the AI defines and executes". **A task is a deliverable the user can test** — not a micro-step.

Example — "CRUD for customers":

- a **history**: "Customer registration"
- **tasks**: list customers · create customer · edit customer · delete customer

Each task is independently buildable and testable. If the whole thing is trivial, make it **a single task**. Don't over-split into "write the failing test" micro-steps (that's execution detail, not planning), and don't under-split "the whole feature" into one opaque blob. Judge by what delivers something the user can actually exercise.

## Writing a task so it can be executed

Write each task so a developer — or a fresh agent with **zero chat context** — can read it, understand it, and execute it correctly. Use sections as needed (not all are always required, but it must be clear how to execute):

- **Objective** — what and why.
- **Expected behavior** — user-visible behavior and rules.
- **Acceptance criteria** — how to know it's done.
- **Decisions** — what was settled during clarification.
- _(as needed)_ constraints, out-of-scope, references, links.

Describe **behavior and intent, not code**. Do **not** write the implementation or hard-prescribe _how_ to build it — the executor decides that — **unless** it's a real constraint or an already-diagnosed bug (then being specific is correct). Naming a real endpoint/table/file is fine; writing function bodies is not.

The test: _could a fresh session execute this task using only its contents?_ If not, it's underspecified — keep refining (go back to the user if needed).

## Where the work lives — sprint, story, or a standalone task

A card doesn't need a sprint to be worked. A sprint-less card in a board status (`todo`…`done`) lives on the **board** on its own; a sprint-less card in the `backlog` status sits in the **backlog**. So choosing the shape is three independent questions:

- **Open a sprint, or not?** A large, cohesive effort worth isolating → its own **sprint**. A small, one-off demand (a handful of quick tasks) → **standalone task(s)** on the board, no sprint. Something that fits what's already underway → the **active sprint**.
- **Group under a story, or not?** A cohesive feature that splits into several testable deliverables → a **story (history) + tasks**. A single coherent deliverable → **one task**.
- **Now, or later?** Worked now → the board (active sprint or standalone). Parked for later → the **backlog** (status `backlog`) or a **future sprint**.

Judge by size and cohesion, not habit. **When in doubt, suggest** a placement — and say why — then confirm with the user; don't silently pick one.

## Key principles

- **One question at a time** — don't overwhelm.
- **Surface decisions, don't assume them** — every meaningful choice goes to the user as ready-made options with trade-offs and a recommendation, before the card exists.
- **Extend, don't stack** — a new demand that extends a **not-yet-started** card (`todo`/`backlog`) updates that card instead of spawning a redundant "fix"; once the card is `in_progress` or beyond, it's locked and the demand becomes its own card.
- **Remove ambiguity before creating** — a decision that lives only in chat is lost; bake it into the card.
- **Approve before executing** — the hard gate above.
- **Review what you created** — for large scopes especially, sweep card by card for pending decisions, gaps and whether the whole still achieves the goal; fix before handing off.
- **YAGNI** — cut features that don't serve the goal.
- **Self-sufficient cards** — each must survive a memoryless future session.
