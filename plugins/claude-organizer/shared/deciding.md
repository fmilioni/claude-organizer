# Resolving decisions — never assume

Shared doctrine for the claude-organizer skills. `plan` and `implement` both reference this single file instead of restating it, so the rule stays consistent and is maintained in one place. Each skill says **when** and at **what scope** it applies the doctrine (planning a card or executing a card); the **method** below is the same everywhere.

## Two kinds of unknown

Both block well-formed work; resolve both **before** writing code (or, in planning, before creating the card):

- **Ambiguities** — anything unclear about what the user wants: vague wording, an unstated expectation, an edge case nothing mentions, "did they mean X or Y?". Even a *small* ambiguity gets a question — don't resolve it by guessing the "probably intended" reading.
- **Decisions** — open choices where more than one reasonable path exists: which library or existing helper, how to shape data, where code lives, a naming/contract call, behavior on an edge case.

## The method

- **For an ambiguity**, a direct question is fine (open-ended where that fits). **For a decision**, present **ready-made options**, not "what do you think?" — each concrete and worked out, with its **trade-offs (pros/cons)**, and the one you **recommend** marked, with the reason. This serves both the user who just takes the recommendation and the one who knows enough to choose differently.
- **One topic per message**; prefer multiple-choice. Use the `AskUserQuestion` tool.
- **Unknowns chain** — settle the earlier one first, because it narrows the next.
- **Research when you can't offer good options from knowledge alone** (e.g. which library exists, its free tier, trade-offs), then present what you found.
- **State the approach before building.** Say in plain terms what you're about to do, so the user can catch a wrong assumption *before* it's code. Don't disappear and come back with choices already made.

## Check before you ask

The answer may already exist — settled in the card's **description** or, crucially, in its **comments**. Read them first; only ask what isn't already answered, and don't re-litigate a settled call.

## Record the answer

Save each resolved decision/clarification as a **comment** on the card (it's signal — see the `claude-organizer` skill), so it survives for the next session and isn't re-asked. When the answer changes the spec itself, fold it into the card's **description** too, so a fresh executor reads a card that's already decided. **When planning** — the card doesn't exist yet — fold the answer straight into the **description** of the card you're about to create (a decision that lives only in chat is lost).

## When to stop

Keep going until **nothing material is left to guess**. Assuming instead of asking (or, for a subagent, instead of stopping and reporting) is a **defect**, the same as skipping a lifecycle step.
