# Bootstrapping a fresh ConPort project

**A repository with a history of git is not bootstrapped: it is onboarded.**
When the root is a repository of git, not a shallow clone, whose main branch
has at least 20 commits on its first-parent line and the first of them is
older than 30 days, follow the onboarding procedure
`references/project-onboarding.md` instead of this guide. This guide is for
the rest: a folder outside git, or a repository with almost no history.

Use this guide right after `mcp__conport__init` for a project ConPort knows
nothing about yet. Goal: give Claude enough baseline to be useful in future
sessions without asking the same questions every time.

---

## When to trigger

Offer the bootstrap flow when **both** of the following hold after `init`:

1. `onboarding.offer` of `init` is true — the project has no product context
   (or an empty one) and no portion of its model. The decisions, progress
   entries and documents it already has do not matter. An agent without the
   MCP server reads `offer` from `GET /api/v1/projects/{project}/onboarding`
   (`npx -y conport@^0.17.0 api arch onboarding --project <project>`).
2. The repository has no history to onboard from (the condition above).

The onboarding procedure sends a project here at its step 0 by the same
condition; then run this guide without checking anything else.

If a constitution-like document exists (`CONSTITUTION.md`, `docs/ADR/` or a
similar onboarding doc), **skip the interactive flow** and instead:
- Read the doc.
- Write its key sections (vision, goals, stack) into the product context, by
  the request of *Persisting the answers* below.
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

1. **Product context** — one request, all answers at once:
   `PATCH /api/v1/projects/{project}/context/product` with
   `{"patch": {…}}`, run through the CLI:
   ```
   npx -y conport@^0.17.0 api context update --project <project> --context_type product --patch '{
     "vision":          "<answer 1>",
     "tech_stack":      "<answer 2>",
     "target_users":    "<answer 3>",
     "success_metrics": "<answer 4>",
     "bootstrapped_at": "<ISO date>"
   }'
   ```
   Without the CLI, `mcp__conport__update_product_context` writes one field
   per call (`field`, `value`) and takes `vision`, `goals`, `features`,
   `architecture`, `tech_stack` and `constraints` only: write `vision` and
   `tech_stack` that way and leave the rest for a session with the CLI.

2. **First decision** — record the bootstrap itself so future sessions know it happened:
   ```
   mcp__conport__sync_decision({
     project: <project>,
     summary: "Project bootstrapped via conport skill",
     rationale: "Captured vision / stack / users / success metrics from the owner's answers during the first session.",
     tags: ["bootstrap", "onboarding"]
   })
   ```

3. **Link external docs** (only if the user pointed to any):
   - Read the doc(s) with the `Read` tool first (don't guess).
   - Store the link as a document via `add_document` with its `doc_type`
     (`spec`, `architecture`, `runbook`, `api_docs`, `tutorial`,
     `meeting_notes`, `plan` or `other`): a document is created only with
     its type.

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
