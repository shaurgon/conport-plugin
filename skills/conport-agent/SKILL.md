---
name: conport-agent
description: Use when managing agent identity, persistent memory, and structured domains in multi-agent systems. Must run agent_init at session start. Agent Intent-API v4 — you express intent (remember / recall / create_kind / event), ConPort handles storage.
metadata:
  version: 15.4.0
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
bootstrap_state      'new' or 'continuing'
identity             your identity statements (private)
principles           your rules / safety rails (private)
broadcast_facts      collective always-load knowledge — facts AND crystallized skills
recent_self_changes  YOUR own identity/principle/skill writes from the last 7 days
skills               [{name, description}] — your authored loops (body fetched on demand via get_skill)
collections          [{key, members, field_hints, status_vocab}] — your structured domains
mature_communities   skill-promotion candidates (dense, stable clusters)
pending_extraction   {buffer_size, message_ids} when un-extracted messages ≥ 10
summary              human-readable status line
```

`recent_self_changes` is your short-term memory of **what you changed about
yourself**. Read it every session before you touch your own skills, config, or
loops — it is the record of "I rewrote X yesterday, here's why". A surface that
looks empty or wrong is not a blank slate; it is a prompt to check this list and
`recall` before you rebuild.

`new` → empty; write your first identity + principles via `remember`.
`continuing` → identity + principles + broadcast_facts are your baseline;
use `recall` for the rest. If `pending_extraction` is present, call
`extract_thread` with its `message_ids` before anything else. Glance at
`collections` so you reuse existing structured domains (don't reinvent them).

**Updates: act on the signal, never hand-compare versions.** Pass your
`skill_id` / `skill_version` / `client_type` to `agent_init`; if it returns
`skill_update_available`, an update exists — install it. If it's absent, you're
current. Your memory provider is ONE installable unit (e.g. `conport-hermes`
for Hermes agents) with its own version line — never compare its number against
the conport plugin's skill numbers, or a skill version against a plugin release
number. They're independent. Eyeballing "my 8.x looks higher than the 12.x
release, so I'm ahead" is the exact mistake this signal prevents (decision-808).

---

## RECALL BEFORE YOU ACT

Your memory is **read-first**, not a write-only journal. You write diligently;
the failure mode is acting without reading. Before you act on a conclusion about
the world OR about yourself, `recall` first.

**The hard rule — never rebuild from a blank-looking surface.** When your own
skill, file, config, or state looks *empty, wrong, or missing*, that is a
`recall` query — NOT a signal to fix it from scratch. You may have changed it
yourself recently and simply not be looking at the record.

```
# WRONG — destroys your own recent work
"my main skill is empty → I'll rebuild it"

# RIGHT — recover the record first
recall("research loop skill", scope={meta_types:["skill"]})   # what did I author?
# + read recent_self_changes from agent_init
# only AFTER that, if it's genuinely gone, rebuild
```

This applies hardest on **diagnose turns** — "what happened", "разберись",
"why this error", "fix this". The first move is `recall` of the relevant area
+ your `recent_self_changes`, THEN inspect the live state. A live surface and
your memory of changing it are two sources; reconcile them, don't trust the
live one blindly and overwrite the other.

**Record what you change about yourself.** When you edit your own skill, cron,
loop, or config, immediately `remember` it so future-you can recall it:

```
remember("2026-06-04 rewrote research-loop: switched topic/source split, "
         "cron now nightly — reason: old approach buried sources under topics",
         meta_type="skill", visibility="broadcast")
```

A self-change you don't record is a change you will later mistake for a bug.
These writes surface in next session's `recent_self_changes` and broadcast
anchors — that is how you avoid re-deciding what you already decided.

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

**Recall returns the current version of a memory.** Superseded nodes are
excluded by default — when you consolidate (a new node + `supersedes` edges to
the old ones), the replaced nodes stop surfacing. Pass
`scope.include_superseded=true` to audit history.

**`relevant_until` — optional validity horizon (both remember forms).**
`remember(..., relevant_until="2026-06-19T00:00:00Z")` marks how long the
memory stays operationally relevant; past it the memory sinks in recall rank —
it is never deleted. Operationally-scoped notes ("deploy frozen this week")
get days; syntheses and durable knowledge — leave unset (indefinite).

---

## THE STRUCTURE DECISION (your only real choice)

**Free thought / observation / principle → `remember(content)`.**
```
remember("the user prefers a warm, dry climate")
```

**A thing you'll filter / compare / update over time, and there'll be more
like it** (cities you score, series you rate, research topics) → a **kind**:

1. New domain? `create_kind("series", fields=[title, rating, imdb, tags, verdict], statuses=[watching, watched, wishlist, dropped])` — once.
2. Before writing items, `get_kind("series")` — use the real fields + a valid status, don't invent them.
3. Write the item's current state:
```
remember(kind="series", name="Severance", fields={rating: 2, status: "dropped", verdict: "weak"})
```
4. Something happened over time → `event`:
```
event(kind="series", name="Severance", note="rewatched the finale, still a 2")
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
- **An item that belongs to another** (a source to a topic, an order to a
  client) declares a **ref in its kind** — `create_kind("source", …, refs={topic:"topic"})`.
  The ref field is validated on write: name a real `topic` or it's rejected
  (`unknown_ref`). Not a link verb (there is none) — you declare the shape once,
  items fill it. The referenced item stays its own findable record, not an
  `event` buried in this one.
- **Mistake?** `entity_delete(kind, name)` — fix it, don't leave a duplicate.

`status` is validated against the kind's `statuses`; unknown fields are
accepted (the schema grows). `recall` finds items by content; `event`s are an
item's timeline (read with `event_query`, not `recall`).

**Doing the same structural work every cycle** (nightly research, daily
scoring)? Don't re-improvise — author the loop once with `write_skill` and
`get_skill` it back next session. See `references/authoring-loops.md` for how to
compose the verbs into a repeatable procedure you write for yourself.

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
- `get_referrers(kind, name)` — the items that reference this one by their
  declared `ref` (a topic's `source`s). Exact provenance — what a synthesis
  rests on — not fuzzy `recall`.
- `graph_stats()` — size and shape of YOUR recall corpus: visible nodes/edges
  with per-type distributions + workspace item count. This is the only correct
  answer to "how big is my memory" — the project surface's `graph_stats`
  measures the owner-wide GraphRAG graph, which `recall` does not search.
- `node_forget(node_id)` — forget a cognition node by id (get the id from a
  `recall` result). Hides it from every read surface — recall, subgraph,
  stats, init; irreversible from the agent surface (the row is archived
  server-side). Prefer `supersedes`-consolidation when a replacement exists;
  forget is for pure noise. Only your own nodes; for items use `entity_delete`.

**Skills — your authored loops:**
- `write_skill(name, description, body)` — when you keep doing the same
  structural work, write the procedure down once instead of re-improvising. The
  `body` (full markdown) is stored and fetched on demand; the one-line
  `description` surfaces in `agent_init.skills` + `recall`. See
  `references/authoring-loops.md`.
- `get_skill(name)` — pull a skill's full body when its description fits what
  you're about to do.

**Skill emergence (different thing — emergent, not authored):**
- `promote_skill(community_id, content)` — when `agent_init` surfaces a
  `mature_community` worth crystallizing, write it up as a broadcast skill node.
  Use the `community_id` from `agent_init`; backend only hints — you decide and
  author the content. (This crystallizes a dense memory cluster; `write_skill`
  is for a procedure you deliberately author.)

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
- [ ] Read `recent_self_changes` before touching your own skills/config?
- [ ] Task arrived → `recall` BEFORE answering?
- [ ] Diagnose turn ("what happened" / "fix this") → `recall` + `recent_self_changes` BEFORE inspecting/rebuilding?
- [ ] A surface looked empty/wrong → recalled your own changes before rebuilding (never rebuild blind)?
- [ ] Changed your own skill/cron/config → `remember`ed it as a self-change?
- [ ] Structured domain → `create_kind` once + `get_kind` before writing items?
- [ ] Item state → `remember(kind,…)`; what-happened → `event`; never list-as-item?
- [ ] Free thought → `remember(content)` with the right visibility?
- [ ] `extraction_signal` fired → `extract_thread` immediately?
- [ ] `mature_communities` → reviewed, promote or skip?
- [ ] No secrets stored?

---

*v15.4.0 | recall-before-act gate (never rebuild a blank-looking surface) + self-change recording + recent_self_changes anchor | Intent API (v4): 5 verbs (create_kind, get_kind, remember, event, recall) + skills (write_skill, get_skill) + refs (create_kind refs + get_referrers) + aux (init, chat_turn, extract_thread, entity_delete, event_query, get_subgraph, graph_stats, node_forget, promote_skill, run_start, run_finish) | Agent expresses intent; ConPort owns storage (sphere graph + event-sourced workspace + skill bodies, hidden) | recall spans cognition + structured items, typed; superseded nodes excluded by default (scope.include_superseded opts in); relevant_until validity horizon (expired memories demoted in rank, never deleted); node_forget soft-lifecycle (forgotten nodes hidden from every read surface, row archived); typed refs between kinds validated on write; authored loops as skills (body on demand); connections built by ConPort | doc-101*
