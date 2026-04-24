# Bootstrapping a fresh ConPort project

Use this guide right after the first `mcp__conport__init` in a repo that has
no prior ConPort context. Goal: give Claude enough baseline to be useful in
future sessions without asking the same questions every time.

---

## When to trigger

Offer the bootstrap flow when **all** of the following hold after `init`:

1. `stats.decisions_total` is `0` **and** `stats.patterns_total` is `0`.
2. `active_context.product_context` is empty or missing the `vision`/`tech_stack`/`goals` fields.
3. No existing `CONSTITUTION.md` / `.specify/memory/constitution.md` / `docs/ADR/` / similar onboarding doc is already in the repo.

If a constitution-like document exists, **skip the interactive flow** and instead:
- Read the doc.
- Call `update_product_context` with its key sections (vision, goals, stack).
- Log a decision: "Bootstrapped from `<path>`".

---

## Interactive flow

Ask the user with **one** `AskUserQuestion` call containing 4 short questions.
Keep each question answerable in one line. If the user skips a question,
don't insist — partial context is still useful.

```
1. What is this project? (one sentence — the vision)
2. Primary tech stack? (e.g. "FastAPI + PostgreSQL + React")
3. Who are the main users? (e.g. "internal dev team", "paying SaaS customers")
4. What does success look like in 3 months?
```

Optional follow-ups (only if the user engages):
- "Any hard constraints I should remember? (deadlines, compliance, budget)"
- "Pointers to existing design docs / ADRs I should read now?"

---

## Persisting the answers

After the user responds:

1. **Product context** — one call, all answers at once:
   ```
   mcp__conport__update_product_context({
     project_id: <id>,
     content: {
       vision:       "<answer 1>",
       tech_stack:   "<answer 2>",
       target_users: "<answer 3>",
       success_metrics: "<answer 4>",
       bootstrapped_at: "<ISO date>"
     }
   })
   ```

2. **First decision** — record the bootstrap itself so future sessions know it happened:
   ```
   mcp__conport__sync_decision({
     project_id: <id>,
     summary: "Project bootstrapped via conport skill",
     rationale: "Captured vision / stack / users / success metrics from the owner's answers during the first session.",
     tags: ["bootstrap", "onboarding"]
   })
   ```

3. **Link external docs** (only if the user pointed to any):
   - Read the doc(s) with the `Read` tool first (don't guess).
   - Store the link as a document via `add_document`.

---

## What NOT to do

- Don't invent answers. If the user didn't supply something, leave the field out.
- Don't bombard with more than 4-5 questions in the first session.
- Don't repeat the flow in later sessions — the presence of a `bootstrapped_at` marker in `product_context` is the signal "already done".
- Don't write planning / design documents automatically. Bootstrap is about
  capturing *what already exists in the owner's head*, not generating new
  artefacts.

---

## Skipping bootstrap

Bootstrap is **always optional**. If the user says "skip" or "just work
without it", proceed normally — ConPort works fine on an empty
`product_context` and will accumulate context organically through
`sync_decision` / `log_progress`.
