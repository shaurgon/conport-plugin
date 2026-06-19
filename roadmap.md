# ConPort roadmap

ConPort is built and maintained by a single developer. The roadmap reflects
that: solo-first priorities for v1–v2, with team-oriented features deferred
until the product earns its keep with individual users.

> **Have an idea or want to vote on priorities?**
> [GitHub Discussions →](https://github.com/shaurgon/conport-plugin/discussions)

---

## Now (shipping / polishing)

- **Works with everything.** One plugin for Claude Code, Cursor, and
  Claude.ai. Whatever you use today, ConPort plugs into it.
- **Time tracking that tells the truth.** Every task carries its
  estimate, the actual time spent, and how accurate the estimate
  was. Project-level totals on the dashboard. Useful for the next
  estimate, useful for noticing where work silently grew.
- **Knowledge stays healthy on its own.** ConPort finds its own
  blind spots — documents nobody references, decisions that
  contradict each other, topics with thin coverage. One command
  runs a cleanup pass that merges duplicates and surfaces the
  contradictions worth resolving.
- **Briefings on demand.** Ask "brief me on task X" or "what did we
  ship for spec Y" and get a one-screen answer assembled from across
  the project. No 47 tabs.
- **Surgical documents.** Edit one paragraph of a spec without
  rewriting the whole thing. Full version history, and a guardrail
  that stops anyone — including the AI — from silently rewriting
  architectural decisions.
- **Documents that link to each other.** Specs say "this supersedes
  that one", "this extends this", "this answers an open question
  over there". The graph quietly tells you when a doc is drifting
  from reality before you waste an afternoon on stale text.
- **Honest about data.** A clear statement of what we store, what
  we don't, and what you can delete.

## Later (deferred)

- **Team features** — shared projects, RBAC, audit logs. Deferred until
  solo experience is rock-solid.

> Plugin and skills in this repo are open. The backend is and will stay
> a hosted service — it's too operationally involved (PostgreSQL +
> pgvector, embedding model, MCP transport, auth, migrations) to make
> self-hosting a supported path. See the public data handling statement
> for the trust story.

## How decisions are made

- Top-voted **Ideas** in Discussions get reviewed monthly
- Roadmap commitments are announced in **Announcements**
- Anything affecting trust (data, pricing, deprecations) goes through
  Discussions before changes ship

## Scope guardrails

If a feature mostly benefits teams of 5+, it's deferred. If it adds
significant ongoing operational burden (background workers, multi-region,
custom infra per tenant), it needs a clear paid-tier justification before
the work starts.
