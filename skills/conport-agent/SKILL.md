---
name: conport-agent
description: Use when managing agent identity, persistent memory, and structured domains in multi-agent systems. Must run agent_init at session start. Agent Intent-API v4 — you express intent (remember / recall / create_kind / event), ConPort handles storage.
metadata:
  version: 8.0.0
---

# ConPort Agent — Intent API (v4)

> ConPort is your **single memory + knowledge system**. You work with
> **intent commands** — say what you want kept or found; ConPort decides
> where it lives, how it connects, and how to retrieve it. You never pick
> storage primitives.
>
> Without `agent_init` — no context. Without `agent_recall` — you answer
> blindly.

### MCP Prefix

Tool names below are short forms. Prepend the prefix for your environment:

- **Claude Code:** `mcp__conport__`
- Other harnesses: see your MCP client config.

---

## FIRST ACTION

1. Resolve the **agent UUID**:
   1. `CONPORT_AGENT_UUID` env var (preferred), or
   2. A platform-specific env var (`PAPERCLIP_AGENT_ID`, `HERMES_AGENT_ID`,
      `OPENCLAW_AGENT_ID`), or
   3. A stable role-derived slug.
2. `agent_init({ uuid: "<resolved_uuid>", name: "<display name>" })`

Response shape:

```
bootstrap_state    'new' or 'continuing'
identity           your identity statements (private)
principles         your rules / safety rails (private)
broadcast_facts    collective facts everyone shares
collections        [{key, members, field_hints, status_vocab}] — your structured domains
mature_communities skill-promotion candidates (dense, stable clusters)
pending_extraction {buffer_size, message_ids} when un-extracted messages ≥ 10
summary            human-readable status line
```

`new` → empty; write your first identity + principles via `remember`.
`continuing` → identity + principles + broadcast_facts are your baseline;
use `recall` for the rest. If `pending_extraction` is present, call
`extract_thread` with its `message_ids` before anything else. Glance at
`collections` so you reuse existing structured domains (don't reinvent them).

---

## THE FIVE VERBS

This is your everyday surface. Express intent; storage is ConPort's job.

| Verb | What it does |
|---|---|
| `remember(content)` | Keep a free thought / fact / observation. |
| `remember(kind, name, fields)` | Keep the current state of a structured item. |
| `recall(query, scope?)` | Find anything relevant — free knowledge AND structured items, one ranked list. |
| `create_kind(name, fields, statuses)` | Declare a structured domain, once (like a table). |
| `get_kind(name)` | Read a domain's form before writing items. |
| `event(kind, name, note, fields?)` | Log a change/what-happened on an item (its timeline). |

You never say "node", "entity", "projection", "link". Connecting things is
ConPort's job — it links by meaning, you don't.

---

## THE STRUCTURE DECISION (your only real choice)

**Free thought / observation / principle → `remember(content)`.**
```
remember("Юра предпочитает тёплый климат и плохо переносит сырость")
```

**A thing you'll filter / compare / update over time, and there'll be more
like it** (cities you score, series you rate, research topics) → a **kind**:

1. New domain? `create_kind("series", fields=[title, rating, imdb, tags, verdict], statuses=[watching, watched, wishlist, dropped])` — once.
2. Before writing items, `get_kind("series")` — use the real fields + a valid status, don't invent them.
3. Write the item's current state:
```
remember(kind="series", name="Severance", fields={rating: 2, status: "dropped", verdict: "хрень"})
```
4. Something happened over time → `event`:
```
event(kind="series", name="Severance", note="пересмотрел финал, всё равно 2")
```

Rules that keep domains clean (skip them and you fragment — `serial` +
`watchlist` + `interests` for one thing, the same item filed twice):

- **One canonical kind per domain** (`series`, not `serial`/`shows`). Check
  `agent_init.collections` / `get_kind` first; reuse, don't reinvent.
  `remember(kind=…)` into an **undeclared** kind fails with `unknown_kind` —
  `create_kind` first.
- **An item is one record.** A list/wishlist is NOT an item — it's the members
  filtered by a `status` field (`recall(..., scope={kind:"series"})` then filter).
  Don't pile items as events on a container.
- **A synthesis/verdict lives in the item's fields** (current state), not a
  separate object. History of how it changed → `event`.
- **Mistake?** `entity_delete(kind, name)` — fix it, don't leave a duplicate.

`status` is validated against the kind's `statuses`; unknown fields are
accepted (the schema grows). `recall` finds items by content; `event`s are an
item's timeline (read with `event_query`, not `recall`).

---

## VISIBILITY (for free `remember`)

Free memories carry a visibility:

| Visibility | Who sees it | Use |
|---|---|---|
| `private` | Only you | Identity, principles, scratch. Identity/principle are forced private. |
| `shared` | All your owner's agents | Default for facts/observations. |
| `broadcast` | All, always loaded | Crystallized skills, core user facts. |

```
remember("...", visibility="broadcast")   # default 'shared'
```

---

## NEVER STORE

- **Secrets, passwords, API keys, tokens** — even partially.
  Bad: `"API key starts with 0a73…"` · Good: `"API key is in $API_KEY env var"`

---

## AUX OPERATIONS

Beyond the five verbs, a few named operations for specific needs. These touch
some internals (communities, the connection graph) — use when you need them.

**Conversation intake (chat harness):**
- `chat_turn(role, text)` — record each message of a live dialogue. When the
  response returns `extraction_signal: true` (buffer ≥ 10), call
  `extract_thread(message_ids)` to distill the buffer into memories. Don't skip it.

**Bootstrap / cleanup / timeline:**
- `agent_init` — session start (above).
- `entity_delete(kind, name)` — delete an item (+ its events) to fix a mistake.
  (Legacy name — it addresses the item by its kind + name.)
- `event_query(entity_id, event_type?, since?, until?)` — read an item's
  timeline. Pass the `item_id` from a `recall` result (events aren't in `recall`).

**Skill emergence:**
- `promote_skill(community_id, content)` — when `agent_init` surfaces a
  `mature_community` worth crystallizing, write it up as a reusable skill
  (broadcast). Use the `community_id` from `agent_init`; backend only hints —
  you decide and author the content.

**Runs (skill-execution tracking):**
- `run_start(skill_name, params?)` → `run_finish(run_id, status, outputs?)` —
  wrap a multi-step skill execution for a traceable record.

---

## MCP PAYLOAD CONTAMINATION

If a write returns `error: "mcp_payload_contaminated"`, a literal MCP tool-call
fragment (`<parameter …>`, `<invoke …>`, `</invoke>`, `<function_calls>`,
`antml:*`) leaked into a string field — a client XML glitch. The response lists
the contaminated fields. Recovery: re-issue with them cleaned. The bad write
did not land.

---

## CHECKLIST

- [ ] `agent_init` done? `bootstrap_state` checked?
- [ ] `pending_extraction` present → `extract_thread` first?
- [ ] Glanced at `collections` — reusing existing domains, not reinventing?
- [ ] Task arrived → `recall` BEFORE answering?
- [ ] Structured domain → `create_kind` once + `get_kind` before writing items?
- [ ] Item state → `remember(kind,…)`; what-happened → `event`; never list-as-item?
- [ ] Free thought → `remember(content)` with the right visibility?
- [ ] `extraction_signal` fired → `extract_thread` immediately?
- [ ] `mature_communities` → reviewed, promote or skip?
- [ ] No secrets stored?

---

*v8.0.0 | Intent API (v4): 5 verbs (create_kind, get_kind, remember, event, recall) + aux (init, chat_turn, extract_thread, entity_delete, event_query, get_subgraph, promote_skill, run_start, run_finish) | Agent expresses intent; ConPort owns storage (sphere graph + event-sourced workspace, hidden) | recall spans cognition + structured items, typed; connections built by ConPort; structured state in item fields, history in events | doc-101*
