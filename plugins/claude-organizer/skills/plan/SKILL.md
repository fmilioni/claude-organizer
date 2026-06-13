---
name: plan
description: Use to turn a NEW fuzzy demand — a feature, a change, a fix — into structured work in claude-organizer (sprints, stories, tasks). Trigger whenever the user describes something new to build before it's broken down, asks to plan/organize the work, or asks to CREATE A CARD (or several) — card creation always runs through this skill, never a direct create_card call. A task that lives in an external tracker is also a planning input — re-map it into card(s) here, don't execute it. Even a single obvious card goes through here. This is PLANNING, not execution — do NOT write code here.
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

Run these steps **in order, for every demand — none skipped**. The flow is identical every time, no matter how small the demand looks; "too simple to plan" is exactly where a wrong assumption gets baked in. The gate steps — approval (4), self-review (6), the user's look at the cards (10) — are mandatory, not optional.

1. **Orient.** Read the current state first: `list_projects` → `get_active_sprint` → `list_unhandled_comments` → `list_cards` (and, when planning the **inbox**, `list_inbox` for the pending demands you'll convert). Then scan the **docs tree** (Modules / Decisions / Notes) and read what's relevant to the demand's area — a past decision or a note can change the design, and modules tell you how the area already works. Don't read everything; glance and decide. Know what exists before proposing anything.
2. **Understand & surface decisions.** Two kinds of unknown block a well-formed card; resolve both _with the user_ before creating anything. The **method** for surfacing them — ready-made options with trade-offs and a recommendation, one topic per message, chaining — lives in _Surfacing decisions, not assuming them_ below; in planning terms the two kinds are:
   - **Ambiguities** — what the user actually wants: goal, scope, constraints, edge cases, what "done" looks like.
   - **Decisions** — open choices with more than one reasonable path (runtime/language, which API or library, auth model, session strategy, storage…). Never pick one silently — surface each as **ready-made options** the user chooses from.
   - **The brief is usually incomplete — hunt the gaps, don't fill them silently.** This is the unknown most often missed: people routinely start a plan with **important pieces unstated** — not because there's no answer, but because they didn't think to say it. So don't take the description as complete. **Actively map** what's probably missing (goal edges, who/when, error and empty states, scale, permissions, what happens to existing data…) and its downstream consequences, and **surface each as a question or a suggestion** to accept or drop. Keep the framing **general** — don't invent concrete specifics the user didn't raise (that biases the plan). The AI **identifies and asks; it never assumes** — the decision is always the user's.
   - **From the inbox** — when the demand(s) come from `list_inbox` (pending), treat **each demand as raw input** to this step: one may become a single task, a story, or several cards. The never-assume rule is unchanged.

   **One topic per message**; prefer multiple-choice (open-ended is fine for ambiguities). Keep going until nothing remains that would materially change what gets built. It's far cheaper to ask now than to bake a wrong assumption into a card executed blindly later.
3. **Organize (propose).** Decide the shape of the work and present it with your reasoning (see _Where the work lives_):
   - **single task** — one coherent, testable deliverable. May live on the board with no sprint (a standalone task) or sit in the backlog for later.
   - **history (story) + tasks** — a cohesive feature split into a few testable deliverables.
   - **sprint + histories + tasks** — a large, cohesive effort worth isolating.

   **Before materializing a new demand, check whether it folds into a card that hasn't started.** Sweep the existing `todo`/`backlog` cards for **deliverable overlap** (on a large board, `search_cards` finds candidates by title/summary/description + comments instead of paging the whole list): if the new demand only extends or adjusts one of those **not-yet-started** cards, **propose updating that card** (scope/description/acceptance) and referencing the origin, instead of stacking a separate "fix" card on top of work that never began — the `update_card` runs in step 5, after approval. **Limit:** this holds only while the card is in `todo` or `backlog`; from `in_progress` onward the card is locked, so the new demand becomes **its own card**. If it isn't clearly the same deliverable, ask the user (never assume). _Example:_ the user asks for "dark mode", then later "detect the system theme" — both serve the same deliverable, so if the dark-mode card is still in `todo`/`backlog`, fold the second demand into it; if it has already left `todo`, open a new card.
4. **Get approval.** Present the proposed structure (and, when useful, 2–3 approaches with a recommendation). Revise until the user approves. Only then create anything.
5. **Create in the MCP.** Materialize the approved structure: `create_sprint` (if needed) → histories (cards) → tasks (cards, with `parentId` for a history's children). Create cards in **dependency order** — a task before the ones that depend on it — so a card you need to reference already has its key. Wire dependencies with blockers when one task must precede another. **Tag every task you create** (see the tagging rule in the `claude-organizer` skill): attach the tags that fit; if none fit, suggest new tag(s) and ask the user before creating them.
   - **Tasks live only as cards — never as a list in prose.** A history's `descriptionMd` describes the _history_: its goal, scope and decisions. It does **not** enumerate its tasks. The tasks ARE the child cards (`parentId`), and the board already shows them nested under the history. Re-listing them in the body creates a second, drifting copy and invites positional references like `CO-46.1` ("task 1 of the history") instead of the card's real key.
   - **No manual numbering in task titles.** Name each task by its **content alone** — never a positional prefix (`T1`, `T1.1`, `T2.3`, `H3 ·`). The board already numbers and groups tasks under their story (parent/child); a manual index duplicates that, reads cluttered, and drifts the moment order changes.
   - **Cross-reference by the card's real key.** When one card points at another — a dependency, a follow-up, "the foundation task" — use the key the MCP assigned (e.g. `CO-51`), which auto-links. Never invent a positional alias (`CO-46.1`, "task 1"): it links to nothing and breaks the moment order or scope changes. Write each key in full — `CO-53, CO-54`, not a shorthand range like `CO-53/54` (only the first half links). This is exactly why you create in dependency order — so the real key exists when you write the reference.
   - **Set `priority` as the card's value — on every card.** `priority` (0–10) is **how much value/importance** the card carries, **not** execution order: order is the reorder pass (step 7) writing each card's `position`. Assign it as you create each card instead of leaving the default `0` — it's the signal that tells apart what's worth most. Rough scale: **8–10** the core value the sprint exists for, **4–7** solid supporting work, **1–3** nice-to-have/polish — and **spread the cards across the range** rather than stamping them all the same number, or the signal is lost. It earns its keep when **execution order is ambiguous** (any story could go first): `position` still fixes a sequence, but `priority` is what says which one actually delivers more. (Board order is `position` ASC, then `priority` DESC as a tiebreak.)
6. **Self-review what you created.** Once the cards exist, read them back with **fresh eyes** before anyone else sees them — a mandatory gate, not a courtesy. Run the checklist in _Self-review_ below and **fix inline**; it's light for a single task and **mandatory and thorough for a large scope** (the section explains why).
7. **Order the board (reorder).** Once the set of cards and their sequence are final, call **`reorder_cards`** once with **every created card id in reading order**; it writes `position = 0,1,2,…` so the board shows the cards top-to-bottom in execution order, independent of how or when each was created.
   - **Reading order, grouped by story:** each story (parent card) immediately followed by its children in execution order, then the next story; standalone cards slotted at their right point. The board renders the parent as an envelope and ranks each story block by the **lowest `position` among its children**, so monotonic positions in reading order place every block correctly (the parent's own `position` is harmless — still pass its id).
   - Worth running even for a single batch of standalone tasks — one call that makes the order explicit instead of leaning on the creation-time fallback.
8. **Close the inbox loop (when planning from the inbox).** Once the cards exist and are ordered, call **`mark_inbox_planned(id, cardKeys[])`** for **each converted demand**, passing the **real keys** of the cards it produced (one demand may map to several keys; auto-linked in the web). A demand the user **discarded** — it became no card — is **not** marked planned; instead **drop it yourself**, asking the user whether to **archive** it (`archive_inbox` — recoverable, the suggested default) or **destroy** it (`destroy_inbox` — gone for good). Don't leave a discarded demand pending "for the user to handle from the web".
9. **Re-check the inbox before handing off.** New demands can land **while you plan** — the user captures something after your step-1 orientation. So before the hand-off, re-run **`list_inbox`** (pending) and compare it against what this session planned (and, when planning from the inbox, the demands you marked in step 8). If a pending demand is left that this plan didn't cover, **surface it and offer to plan it now** — a single offer, don't nag. Applies to every planning flow, not only inbox-driven ones.
10. **Present for review, then hand off.** Show the user the final card set (each card's key + one line, grouped by story) for a last look before execution — the cards are the artifact, so let the user catch a wrong call while it's still cheap to change. Apply any change inline. Then hand off: execution proceeds via the **`implement`** skill, card by card (`in_progress` → read comments → implement → review → commit → done), with the user validating each card, and the **`review`** skill's gate (per-task + story-level) before work closes.

## Surfacing decisions, not assuming them

A demand almost always hides choices with more than one defensible answer. The wrong move — and the easy one — is to silently pick one and bake it into a card; that's a decision made _for_ the user instead of _by_ them. Surface it. This holds even for demands that look trivial: "too simple to have decisions" is exactly where a silent assumption slips in.

The **method** for surfacing a decision:

- **Ambiguity → a direct question** (open-ended where that fits). **Decision → ready-made options**, never "what do you think?": each option concrete and worked out, with its **trade-offs**. Mark the one you recommend with a **recommended marker** in the option's **title/label**, written in the **same language as the question** (the user's language — e.g. `(Recommended)` in English, `(Recomendado)` in pt-BR) — not buried in its description — and list it **first** (the marker goes in the title; the *why* may go in the description). That serves both the user who takes the recommendation and the one who knows enough to choose differently. This is what `AskUserQuestion` expects: recommended option first, marked in its label.
- **One topic per message**; prefer multiple-choice via the `AskUserQuestion` tool.
- **Unknowns chain** — settle the earlier one first; it narrows the next. Example chain: "get the current temperature" hides *how to access it* (Node/Python/shell) then *which weather API* (free tier, accuracy, rate limits); "build an auth system" hides OAuth-or-not, identity providers, session as token or cookie, hashing algorithm, and so on.
- **Research when knowledge alone won't yield good options** (which library exists, its free tier, trade-offs), then present what you found.
- **State the approach before building** — say in plain terms what you're about to do, so the user can catch a wrong assumption *before* it's baked into a card; don't disappear and return with the choices already made.

Before you ask, **check what's already settled** — a past decision in the docs, an existing not-yet-started card, the demand's own text — and don't re-litigate a settled call.

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

**An image in the source is carried into the card, not just described.** When the demand arrives with an image — an inbox item with a screenshot, a pasted mockup — open it (`ReadMcpResource attachment://<id>`; the `uri` and the `id` are in the payload's `attachments` array) to grasp what it shows, then **embed it in the card it belongs to**: write `![<short description>](/attachments/<id>)` into that card's `descriptionMd`, using the attachment's own `id` (`att_…`) and mapping each image to its right card/section (the editor screenshot on the editor card, the per-modal mockup on the modal card). You **reuse the file already stored in the project by reference** — the same `att_…` renders in the card; you don't (and can't) upload a new one from here. The **`alt` text is the searchable description** — make it specific (`![the misaligned toggle in the editor toolbar](…)`), so the card is found by words alone and a fresh executor knows what it depicts before opening the pixels. Embedding is the default; describing in prose without the image is not enough.

Describe **behavior and intent, not code**. Do **not** write the implementation or hard-prescribe _how_ to build it — the executor decides that — **unless** it's a real constraint or an already-diagnosed bug (then being specific is correct). Naming a real endpoint/table/file is fine; writing function bodies is not.

The test: _could a fresh session execute this task using only its contents?_ If not, it's underspecified — keep refining (go back to the user if needed).

## Where the work lives — sprint, story, or a standalone task

A card doesn't need a sprint to be worked. A sprint-less card in a board status (`todo`…`done`) lives on the **board** on its own; a sprint-less card in the `backlog` status sits in the **backlog**. So choosing the shape is three independent questions:

- **Open a sprint, or not?** A large, cohesive effort worth isolating → its own **sprint**. A small, one-off demand (a handful of quick tasks) → **standalone task(s)** on the board, no sprint. Something that fits what's already underway → the **active sprint**.
- **Group under a story, or not?** A cohesive feature that splits into several testable deliverables → a **story (history) + tasks**. A single coherent deliverable → **one task**.
- **Now, or later?** Worked now → the board (active sprint or standalone). Parked for later → the **backlog** (status `backlog`) or a **future sprint**.

Judge by size and cohesion, not habit. **When in doubt, suggest** a placement — and say why — then confirm with the user; don't silently pick one.

## A task from an external tracker is a planning input

When the user asks to **implement a task that lives in another tracker** — a company issue tracker, a board in a different tool — that request is a **planning input, not a trigger for `implement`**. The external board's granularity rarely matches ours: a "task" there may be a **story** here (several deliverables) or part of a **sprint**, and our flow (self-sufficient card, resolved decisions, review gate, lifecycle) needs a **local card** to run against — without one, `implement` runs blind. So the demand enters here, through `plan`:

- **Treat the external task as a raw demand** — like an inbox item or any new demand: understand it, then **dimension** it (single task, history + tasks, or a sprint — see _Where the work lives_), surface decisions, get approval, then create the card(s).
- **Capture the origin reference.** Record the external id/title in the card's description or summary so the work traces back to its source; don't invent a positional alias for it.
- **A restriction from the source is a constraint, not prescribed code.** The _behavior and intent, not code_ rule still holds (see _Writing a task_). But when the external task **imposes** something concrete — "use library X", "hit endpoint Y", "follow contract Z" — that isn't writing code in the description, it's a **real constraint**: fold it in as an **acceptance criterion / decision** (the same exception that lets a card be specific for a real constraint or an already-diagnosed bug). Outside such constraints, don't prescribe the _how_ — the executor decides.

Keep the language **generic** — describe the mechanism (an external tracker), never name a specific product.

## Self-review — read the cards back with fresh eyes

After creating the cards, review them yourself before the user ever looks — a checklist **you** run (not a subagent dispatch), with fresh eyes, as if you were a reviewer who didn't write them. This is the gate step 6 enforces. Fix every issue **inline** — adjust, split, merge or drop cards — then tell the user what you changed; no need to re-review your own pass, just fix and move on to presenting the set to the user (step 10). Scale to scope: light for a single task; **mandatory and thorough for a large scope** (multiple sprints, dozens of cards), where a card most easily comes out thin.

Run these checks card by card, then across the whole set:

1. **Placeholder / red-flag scan** — no `TBD`/`TODO`, no half-written section, no vague acceptance that says nothing ("add validation", "handle edge cases", "appropriate error handling"). No "similar to CO-X" standing in for the actual constraint — write the constraint out. No reference to a card/key that doesn't exist.
2. **Coverage** — walk the demand and point each part to a card that delivers it; list any gap and close it (add or adjust a card).
3. **Self-sufficiency** — each card passes the memoryless-session test (_Writing a task_): a fresh agent with zero chat context could execute it from its contents alone, and it stays a **usable, testable deliverable** — not a micro-step.
4. **Pending decisions** — did an open choice slip through unsettled? Surface it to the user, then fold the answer into the card (a decision that lives only in chat is lost).
5. **Consistency & coherence** — cards don't contradict each other; dependency order holds (no card depends on one ordered after it); no gap or overlap between cards; every cross-reference uses the real card key; names and terms line up across cards (a table called `customer` in one card and `client` in another is a bug).
6. **Scope & objective** — step back to the whole: does the set actually achieve the objective the user set? YAGNI — cut a card that doesn't serve the goal. Right granularity — neither over-split into micro-steps nor an opaque blob.
7. **Order** — settle the intended top-to-bottom execution/reading order now; step 7 writes it to the board.

## Key principles

- **One question at a time** — don't overwhelm.
- **Surface decisions, don't assume them** — every meaningful choice goes to the user as ready-made options with trade-offs and a recommendation, before the card exists.
- **Assume the brief is incomplete — hunt the gaps** — a demand almost always omits things the user wanted but didn't think to state. Actively map the probable gaps and **ask**; never silently fill them in. The decision stays the user's.
- **Extend, don't stack** — a new demand that extends a **not-yet-started** card (`todo`/`backlog`) updates that card instead of spawning a redundant "fix"; once the card is `in_progress` or beyond, it's locked and the demand becomes its own card.
- **Remove ambiguity before creating** — a decision that lives only in chat is lost; bake it into the card.
- **Approve before executing** — the hard gate above.
- **Self-review with fresh eyes** — before handing off, read every card back as if you didn't write it (placeholders, coverage, self-sufficiency, pending decisions, consistency, scope) and fix inline; mandatory for large scopes. The cards are usable, testable deliverables — keep them that way.
- **YAGNI** — cut features that don't serve the goal.
- **Self-sufficient cards** — each must survive a memoryless future session.
