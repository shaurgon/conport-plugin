# Authoring your own loop for a structural domain

> You know the five verbs. This is the missing middle: when you keep doing the
> **same structural work** (research every night, scoring every day), don't
> re-improvise the procedure each time — **author a loop once, save it as a
> skill (a one-line description for discovery + the full procedure in storage),
> and pull it back next session.** Improvising a recurring cycle is how you end
> up with a half-empty domain and a synthesis nobody can read back.

This is `create_kind` / `remember` / `event` / `recall` composed into a
repeatable procedure. The verbs are the primitives; the loop is the program you
write with them — and you write it for *yourself*.

---

## When to author a loop

- You've run (or foresee) the **same structural cycle more than once** on one
  domain — a nightly research sweep, a daily city-score refresh, a watchlist
  triage.
- The work has a clear shape: *find the relevant items → pick what to work on →
  do it → record what happened → update the current state.*

**Don't** author a loop for a one-off, or for free cognition. A single
`remember(content)` is not a loop. If you only ever touch a domain once, skip
this.

---

## The five steps

### 1. Pin the kind
`get_kind(name)` — does the domain already exist? Reuse it. If not,
`create_kind(name, fields, statuses)`. Decide, once and explicitly:
- **`fields` = current state** — what `recall` should hand back: the synthesis,
  the verdict, the live queue. This is the read surface.
- **`event` = history** — each "what happened" (a paper read, a score change).
  Lands in the timeline, not in `recall`.
- **`statuses` = lifecycle** — and if the domain is open-ended, leave out any
  terminal value. A research thread is never `concluded`; it's
  `expanding`/`paused`/`dormant`.

### 2. Write the loop steps explicitly
The canonical shape — copy it and fill in:
```
recall(scope={kind: "<domain>"})        # pull the relevant items
  → pick the item(s) to work on          # your prioritization — step 3
  → do the work                          # read, fetch, compute, think
  → event(kind, name, note, fields)      # record WHAT happened (the checklist)
  → remember(kind, name, fields)         # rewrite the CURRENT state + queue
```
Write these as plain numbered instructions to future-you. Vague steps are how
you drift.

### 3. Make your prioritization explicit
This is the part that is **yours and scenario-specific** — it does NOT belong in
the generic five-verb rules, it belongs *here, in your loop*. State it in words:
- research → "rank `expanding` topics by relevance × staleness
  (`last_explored_at`), take the top topic's first `open_question`";
- scoring → "recompute every candidate's score from today's signals, re-sort";
- watchlist → "filter `status: wishlist`, pick by mood + runtime".

A prioritization you keep in your head is one you'll apply inconsistently. Put
it in the loop.

### 4. State the stop (or never-stop) condition
- Open-ended domain → **never concludes.** The queue is the engine: while an
  item has `open_questions`, it stays `expanding`; a dead end doesn't close the
  item, it spawns the next question. Say so explicitly so future-you doesn't
  invent a fake "done".
- Bounded domain → name the real terminal state and when it's reached.

### 5. Save the loop as a skill
A loop is a procedure, and procedures get long — so a skill is split, like this
very file: a short **description** (when to use it) for discovery, and the full
**body** kept in storage, fetched only when you run it.
```
write_skill(
  name="<domain>-loop",
  description="when to run this and what it does — one line",
  body="<the loop you wrote, steps 2–4>"
)
```
- Your skill **descriptions** load every session (`agent_init`) and surface in
  `recall` — future-you sees the loop *exists* without drowning in its text.
- When a description fits, `get_skill("<domain>-loop")` pulls the full body —
  one loop, on demand, not the whole pile.

Next session: read your descriptions, `get_skill` the one that fits, follow it —
don't reinvent it.

---

## When items reference items

Some domains have items that point at other items — a `source` belongs to a
`topic`, an `order` to a `client`, a measurement to a `city`. **Declare the
reference in the kind**, once — don't rely on remembering to fill a loose field:
```
create_kind("source",
  fields=["key_theses", "applicability", "self_check", "url"],
  refs={topic: "topic"})            # a source references a `topic` item, by name

remember(kind="source", name="arxiv:2403.xxxx",
  fields={topic: "mcp-security", key_theses: [...], applicability: "..."})
```
The `refs` declaration makes the link **explicit and checked**: the `topic`
value must name a real `topic` item, or the write is rejected (`unknown_ref`) —
so you can't forget it or fill it with a near-miss spelling. `get_kind("source")`
shows its refs; the topic's sources are joined back by **exact name**, not
guessed by similarity.

A ref is NOT a per-record link call — you declare the *shape* once in
`create_kind` and each item just fills the validated ref field. (The `link` verb
does connect individual memories, but that's for free-cognition nodes, not
structured items — items point at each other through declared refs.)

Keep the layers straight — this is the trap:
- The **synthesis / verdict** for the whole domain lives on the **container
  item** (`topic`'s `synthesis` + `open_questions`).
- Each **piece of evidence is its own item** (`source`) — found by `recall`,
  carrying its own checklist (`key_theses`, `applicability`, `self_check`). It is
  **NOT an `event`** (events aren't searchable — you'd never find that paper again).
- An **`event`** is what *changed over time* (re-read a source, re-scored a city)
  — **not** the arrival of a new item.

So a research loop is two kinds — `topic` (synthesis) and `source` (evidence) —
joined by a declared, validated `topic` ref.

---

## Anti-patterns

| Smell | Why it rots | Instead |
|---|---|---|
| Write-only synthesis | If `fields` aren't what `recall` returns, nobody reads them back and they decay into box-ticking | Put the live verdict/queue in `fields` — read-path == write-path |
| A "list"/"all-topics" item | A container that accretes everything is not an item | An item is one record; the "list" is members filtered by `status` |
| Prioritization in your head | Applied differently every run, silently | Write it into the loop (step 3) |
| Re-improvising the cycle | You already solved this; you just didn't save it | `get_skill` the loop you already wrote first |
| Dumping the whole loop body into every turn | A 600-line procedure inline drowns you | Description for discovery; `get_skill` the body only when you run it |
| One `event` auto-fired per `remember` | Floods the timeline | `event` = what happened; `remember` = current state; emit each deliberately |
| Terminal status on an open domain | Forces a fake "concluded" and kills the engine | Cyclical statuses; the queue keeps it alive |

---

## Checklist

- [ ] Recurring cycle (not a one-off) → worth a loop?
- [ ] Kind pinned: `fields` = current state (what recall returns), `event` = history?
- [ ] `statuses` fit the lifecycle — no fake terminal on an open domain?
- [ ] Loop steps written explicitly (recall → pick → act → event → rewrite)?
- [ ] Prioritization stated in words, in the loop — not in your head?
- [ ] Stop / never-stop condition named?
- [ ] Loop saved with `write_skill` — a one-line description for discovery, body in storage?

---

*Companion to the structure decision in SKILL.md. The verbs are primitives;
this is how you compose them into a procedure you write for yourself. Data
contract: doc-101.*
