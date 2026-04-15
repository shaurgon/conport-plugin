# ConPort roadmap

ConPort is built and maintained by a single developer. The roadmap reflects
that: solo-first priorities for v1–v2, with team-oriented features deferred
until the product earns its keep with individual users.

> **Have an idea or want to vote on priorities?**
> [GitHub Discussions →](https://github.com/shaurgon/conport-plugin/discussions)

---

## Now (shipping / polishing)

- Three-domain stack live: `conport.app` (landing), `me.conport.app` (dashboard), `api.conport.app` (backend + MCP)
- Multi-client plugin install (Claude Code, Cursor, Claude.ai, OpenClaw, mcporter, Paperclip)
- Public free-tier opening (first project free, paid for more — pricing TBD)
- Public data handling statement
- This feedback channel

## Next (post-launch, solo-friendly)

- Custom SMTP for magic-link emails (`noreply@conport.app`)
- L3 pipelines for agent memory (background consolidation)
- Plugin polish based on real-world usage feedback

## Later (deferred)

- **Team features** — shared projects, RBAC, audit logs. Deferred until
  solo experience is rock-solid.
- **OSS** — backend stays closed source for now (see public data handling
  statement for the trust story). Plugin and skills are open in this repo.
- **Self-hosted distribution** — possible if there's demand. Not a priority.

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
