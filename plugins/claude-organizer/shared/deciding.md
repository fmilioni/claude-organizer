# Resolving decisions — never assume

Shared doctrine for the claude-organizer skills. `plan` and `implement` both reference this single file instead of restating it, so the rule stays consistent and lives in one place. Each skill states **when** and at **what scope** it applies the doctrine (planning a card, executing a card); the **method** below is the same everywhere.

## Two kinds of unknown

Both block well-formed work; resolve both **before** writing code (or, in planning, before creating the card):

- **Ambiguity** — anything unclear about what the user wants: vague wording, an unstated expectation, an edge case nothing mentions, "did they mean X or Y?". Even a *small* one gets a question — don't settle it by guessing the "probably intended" reading.
- **Decision** — an open choice where more than one reasonable path exists: which library or existing helper, how to shape data, where code lives, a naming/contract call, behavior on an edge case.

## The method

- **Ambiguity** → a direct question (open-ended where that fits). **Decision** → **ready-made options**, not "what do you think?": each one concrete and worked out, with its **trade-offs**, and the one you **recommend** marked and justified. That serves both the user who takes the recommendation and the one who knows enough to choose differently.
- **One topic per message**; prefer multiple-choice. Use the `AskUserQuestion` tool.
- **Unknowns chain** — settle the earlier one first; it narrows the next.
- **Research when knowledge alone won't yield good options** (which library exists, its free tier, trade-offs), then present what you found.
- **State the approach before building.** Say in plain terms what you're about to do, so the user can catch a wrong assumption *before* it's code — don't disappear and return with the choices already made.

## Check before you ask

The answer may already exist — in the card's **description** or, crucially, its **comments**. Read them first; ask only what isn't already answered, and don't re-litigate a settled call.

## Record the answer

Save each resolved decision as a **comment** on the card (it's signal — see the `claude-organizer` skill), so it survives for the next session and isn't re-asked. When the answer changes the spec, fold it into the card's **description** too, so a fresh executor reads a card that's already decided. **When planning** — the card doesn't exist yet — fold the answer straight into the **description** of the card you're about to create (a decision that lives only in chat is lost).

## When to stop

Keep going until **nothing material is left to guess**. Assuming instead of asking is a **defect** — the same as skipping a lifecycle step.
