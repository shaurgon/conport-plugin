---
name: conport-agent
description: Use when managing agent identity, persistent memory, and structured domains in multi-agent systems. Must run agent_init at session start. Agent Intent-API v4 — you express intent (remember / recall / create_kind / event), ConPort handles storage.
metadata:
  version: 15.14.0
---

# ConPort Agent — Intent API (v4)

> ConPort is your **single memory + knowledge system**. You work with
> **intent commands** — say what you want kept or found; ConPort decides
> where it lives, how it connects, and how to retrieve it. You never pick
> storage primitives.
>
> Without `agent_init` — no context. Without `recall` — you answer blindly.

This skill carries the **always-on discipline** — bootstrap, recall-before-act,
the core verbs, the structure decision, visibility, and the never-store rule.
Deep, situational reference (the full intent-API semantics, the edge-type
vocabulary and edge grounding, typed refs, and the aux operations) lives in the
**live docs** — see the *Live docs* section. Fetch the relevant page before
acting on one of those topics; don't act from memory.

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
release, so I'm ahead" is the exact mistake this signal prevents.

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

## THE CORE VERBS

This is your everyday surface. Express intent; storage is ConPort's job.

| Verb | What it does |
|---|---|
| `remember(content)` | Keep a free thought / fact / observation. |
| `remember(kind, name, fields)` | Keep the current state of a structured item. |
| `recall(query, intent?, scope?)` | Find anything relevant — free knowledge AND structured items, one ranked list. |
| `create_kind(name, fields, statuses)` | Declare a structured domain, once (like a table). |
| `get_kind(name)` | Read a domain's form before writing items. |
| `event(kind, name, note, fields?)` | Log a change/what-happened on an item (its timeline). |
| `link(from_node_id, to_node_id, edge_type)` | Assert a connection between two memories you already have. |

**Connecting memories.** ConPort auto-links every new memory to its nearest
existing ones by meaning — you get a connected graph for free. Assert a
connection yourself only when it's one ConPort wouldn't infer from similarity
("derived from", "competing view", "supersedes"): on write via
`remember(content, edges=[{target_node_id, edge_type}])`, or between two existing
memories via `link(from_node_id, to_node_id, edge_type)`. The edge-type
vocabulary is a **fixed, curated set of 12** (6 structural + 6 domain) — pick the
closest; an unrecognized type returns `invalid_edge_type`. Malformed edges come
back as structured `edge_errors`, never a silent drop. → Deep detail (the full
vocabulary, edge `properties` grounding, why ground edges, typed refs between
items): live docs `agents/edges-and-refs`.

**Recall returns the current version** — superseded nodes are excluded by default
(pass `scope.include_superseded=true` to audit history). `intent` and
`relevant_until` are optional refinements. → Deep detail: live docs
`agents/recall-before-act`, `agents/intent-api`.

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
  filtered by a `status` field. Enumerate them exhaustively with
  `entity_list("series", attrs_filter={status:"wishlist"})` (exact, every match);
  `recall(..., scope={kind:"series"})` is a fuzzy/ranked slice, not the complete set.
- **A synthesis/verdict lives in the item's fields** (current state), not a
  separate object. History of how it changed → `event`.
- **An item that belongs to another** (a source to a topic) declares a **ref in
  its kind** — `create_kind("source", …, refs={topic:"topic"})`. The ref field is
  validated on write (`unknown_ref` if the target doesn't exist). → Deep detail
  (single vs `multi` refs, `get_referrers`): live docs `agents/edges-and-refs`.
- **Mistake?** `entity_delete(kind, name)` — fix it, don't leave a duplicate.

`status` is validated against the kind's `statuses`; unknown fields are accepted
(the schema grows). `recall` finds items by content; `event`s are an item's
timeline (read with `event_query`, not `recall`).

---

## VISIBILITY (for free `remember`)

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

Beyond the core verbs, named operations for specific needs. Reach for these when
you need them; **fetch the live-docs `agents/aux-operations` page for the full
semantics before acting** — the error shapes and provenance rules matter.

- **`chat_turn(role, text)`** — record each message of a live dialogue. On
  `extraction_signal: true` (buffer ≥ 10), call `extract_thread(message_ids)` to
  distill the buffer (it runs an LLM over the buffered thread). Don't skip it.
- **`extract_into(nodes, edges, <source>)`** — you read a source, extract the
  graph yourself, persist it ONCE; ConPort auto-stamps `derived_from` provenance.
  Pick EXACTLY ONE source (a cognition node or a workspace item). No LLM
  server-side. (Contrast: `extract_thread` runs an LLM over a buffered chat.)
- **`entity_list(kind, attrs_filter?, limit?)`** — enumerate the actual members
  of a kind (exact, exhaustive, owner-scoped). The right verb for "give me ALL
  items of kind X" — not `get_kind` (form + count only), not
  `recall(scope={kind})` (fuzzy slice), not `get_referrers` (inverse refs).
- **`event_query(entity_id, …)`** — read an item's timeline (events aren't in `recall`).
- **`entity_delete(kind, name)`** — soft-delete an item; events survive, re-remember resurrects.
- **`get_referrers(kind, name)`** — items that reference this one by their declared ref.
- **`graph_stats()`** — size/shape of YOUR recall corpus (incl. `superseded_count`).
- **`node_forget(node_id)`** — forget your own noise node (irreversible from the agent surface; prefer `supersedes`-consolidation when a replacement exists).
- **`node_mute(node_id)` / `node_unmute(node_id)`** — per-viewer hide (reversible; someone else's shared/broadcast noise).
- **`promote_skill(community_id, content)`** — crystallize a `mature_community` into a broadcast skill node.
- **`run_start(skill_name, params?)` → `run_finish(run_id, status, outputs?)`** — wrap a multi-step skill execution.

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
- [ ] Deep topic (edges/refs/grounding, aux ops, intent-API semantics) → fetched the live-docs page before acting?

---

## Live docs

The deep, situational reference lives at **https://conport.app/agents** and is
the single source of truth. **Before acting on a deep topic, fetch the relevant
page.** Index: **https://conport.app/agents/llms.txt**. (No web fetch? Use the
`conport-agent docs <topic>` CLI.)

| Topic | Page |
|---|---|
| Intent API v4 (full bootstrap + verbs + structure semantics) | `agents/intent-api` |
| Recall-before-act (deep) + visibility + `relevant_until` + `intent` | `agents/recall-before-act` |
| Edges, the 12-type vocabulary, edge grounding, typed refs | `agents/edges-and-refs` |
| Aux operations (chat intake, `extract_into`, enumeration, lifecycle, runs) | `agents/aux-operations` |

---

*v15.14.0 | Thinned skill — always-on discipline here, deep reference routed to live docs at conport.app/agents | recall-before-act gate (never rebuild a blank-looking surface) + self-change recording + recent_self_changes anchor | Intent API (v4): 6 verbs (create_kind, get_kind, remember, link, event, recall) + typed refs + aux ops (chat_turn, extract_thread, extract_into, entity_list, entity_delete, event_query, graph_stats, node_forget, node_mute, node_unmute, promote_skill, run_start/finish) | Agent expresses intent; ConPort owns storage | recall spans cognition + structured items, superseded excluded by default; relevant_until validity horizon; 12 edge types (6 structural + 6 domain) with optional grounding properties; extract_into agent-extracted graph with auto derived_from provenance*
