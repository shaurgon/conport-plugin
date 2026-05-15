# Documentation Graph — agent reference

Long-form companion to the **Documentation Graph: callout decision** table
in SKILL.md. Read this when you need to make a non-trivial call about
which callout to use, where to place it, or how the resulting edges
affect downstream rendering and drift detection.

## Why authored callouts matter

A document corpus accumulates three kinds of drift silently when nothing
links docs to one another:

| Drift class | Shape |
|---|---|
| **Promotion drift** | A section in an old doc grows into its own spec; the old section keeps the outdated wording. Readers don't know which one to trust. |
| **Resolution drift** | An open question gets answered in a newer doc; the original doc still says "TBD". Active misinformation. |
| **Synthesis drift** | A summary doc enumerates source decisions in its preamble; new decisions on the same topic don't get added. |

Authored callouts encode the relationships explicitly, so re-reading the
old doc surfaces "moved here" / "resolved here" stubs instead of stale
claims. They also tell the drift detector that two related docs are
already linked — pairs of sections between them stop being flagged.

## Picking the right callout

Decision flow when you're about to `add_document` or `update_document`
with overlapping content:

```
1. search the corpus for topic.
2. Got hits? → which relationship?
   - "I'm replacing what they say"           → [!supersedes]
   - "I'm answering a question they asked"   → [!resolves]
   - "I'm adding more detail; they're still
      authoritative for their layer"          → [!extends]
   - "Both authoritative; cross-cutting"     → [!relates-to]
   - Unsure? → [!relates-to]
3. Where does the callout live?
   - In the NEWER / superseding / extending doc — never edit the older one.
   - For [!relates-to] doc-pair: in either, doc-level (preamble) is enough.
```

### Examples

**Supersedes — old guideline replaced by new spec.**

```markdown
# Authentication Spec

> [!supersedes] [[doc-12]]
> Replaces the older Authentication Guidelines wholesale.

## 1. JWT Validation
...
```

The old doc-12 stays untouched. When a reader opens it with stub rendering
on, every section in doc-12 is wrapped with a "moved" stub linking to
doc-N#section, and the original markdown is folded into a `<details>`
collapse for historical reference.

**Resolves — answering an open question.**

```markdown
# Stripe vs Polar — Decision

> [!resolves] [[doc-12#open-questions-billing]]
> Closes the billing-provider question raised in doc-12.

## Decision
We're going with Polar.
```

The original doc-12's "Open Questions" section gets a "resolved by" stub
above it, with the unmodified questions still visible inline.

**Extends — adding detail to a foundation doc.**

```markdown
# Auto-Reflection Spec

> [!extends] [[doc-28]]
> Adds the supersede / dedup runtime on top of Agent Memory Spec.
```

doc-28 (Agent Memory) and this doc both stay canonical. Rendering inserts
an "extended by" stub in doc-28 sections that this extension references,
without collapsing them — readers get a discovery hint, not a redirect.

**Relates-to — cross-cutting concern.**

```markdown
# Multi-tenancy + RLS Spec

> [!relates-to] [[doc-15]]
> Cross-cutting Security Guidelines (doc-15) detail policies; this doc
> details RLS implementation. Both canonical at their layer.
```

Pure backlink — no stub injected. The Referenced-by panel in doc-15 will
show this spec as an incoming relates-to edge.

## Doc-level vs section-level callouts

A callout in the document preamble (before any heading) applies to the
whole document. A callout at the start of a section applies to that
section only.

For drift suppression, **one edge between two docs is enough** — you don't
need to repeat callouts per section. So for cross-cutting clusters
(Security ↔ Auth ↔ Multi-tenancy ↔ DB schema), a single doc-level
`[!relates-to]` callout in each specific spec pointing at the cross-
cutting hub closes all section-level drift between them.

For supersedes / resolves where you want render-time stubs at specific
sections, use section-level callouts so the stubs land in the right place.

## Anchor stability

Without `^id`, a section's anchor is its heading slug — kebab-cased
ASCII. Examples:
- `## Authentication` → `authentication`
- `## Open Questions / TBD` → `open-questions-tbd`

The slug is **deterministic from the heading text**, so:
- Edit content, keep heading → anchor preserved → wikilinks survive.
- Rename heading → slug changes → incoming wikilinks break (become
  "dangling").

Pin the anchor with `^id` after the heading text when you expect
cross-document links:

```markdown
## Authentication Flow ^auth-flow

(content)
```

`^auth-flow` is now the canonical anchor for this section regardless of
heading rename. Use only when needed — explicit anchors clutter the
markdown source.

## Wikilinks

Inline `[[doc-N]]`, `[[doc-N#anchor]]`, `[[decision-N]]` references in
flowing prose are parsed as low-weight `relates_to` edges. They show in
the Referenced-by panel without rendering stubs on the target.

Targets resolve within the current project. Cross-project syntax
(`[[project-X/doc-Y]]`) is reserved but not parsed yet.

## Drift detection thresholds

The `unmarked_supersession` detector emits a gap when two sections in
different active docs:
- Have a representative-chunk cosine similarity ≥ 0.90 (the
  drift_score), AND
- Have no `document_links` edge between their docs (any direction, any
  anchor combination).

Severity high ≥ 0.95, low 0.90–0.95. Tunable per-project via
`custom_data.gap_thresholds` keys: `drift_cosine_prefilter`,
`drift_score_threshold_low`, `drift_score_threshold_high`.

`stale_open_question` triggers on sections whose heading matches
`/^open\s+questions?[:.!?]?\s*$/i` and whose containing doc is older than
30 days with no incoming `resolves` edge.

`dangling_wikilink` triggers when a callout or wikilink target item or
section anchor doesn't resolve.

`malformed_callout` triggers on lines that look like `> [!type] [[...]]`
but failed to parse (unknown type, missing target).

## Closing existing drift gaps

Two paths, both spec-blessed:

**Author the relationship.** Edit the right doc, add a callout. The next
ingest cycle creates a `document_links` row, and the next detection run
auto-resolves the gap.

**Dismiss with a reason.** When two docs are independently authoritative
on their own layer (cross-cutting concern), use `gap_dismiss` with a
short reason. The dismissal is keyed on a stable hash of the gap
identity, so it survives re-detection runs and threshold tuning.

For mass dismissal of a known cross-cutting cluster, use
`gap_dismiss_bulk(project_id, reason, category|gap_type|subject_type)` —
one shared reason gets stamped on every affected gap. At least one filter
is required so the call cannot wipe the whole backlog by accident.

## Spec docs that contain example markup

If the doc you're writing is itself documenting Wave 5 conventions, the
parser ignores fenced code blocks when scanning for callouts and
wikilinks. Examples like `> [!moved] [[doc-12]]` inside a ` ```markdown`
block won't be parsed as real edges, so they don't produce false-positive
drift or dangling wikilink gaps.

## Tools

- `get_block_backlinks(project_id, document_id, [block_ulid], [edge_types])`
  — incoming `document_links` for the doc or one of its blocks.
- `get_semantically_related_blocks(project_id, document_id, block_ulid, [limit], [threshold])`
  — top-N semantically similar blocks in OTHER docs, excluding already-
  linked targets.
- `get_linked(project_id, item_type='document', item_id, include_section_links=true)`
  — combined item-graph + Wave 5 section edges for one document.
- `get_document(project_id, document_id, raw=false)` — full markdown with
  render-time stubs from incoming supersedes/resolves/extends edges.
  Pass `raw=true` to bypass.
- `gap_dismiss(project_id, gap_hash, reason)` — close a drift gap that
  isn't actually drift; reason is mandatory for audit.
- `gap_dismiss_bulk(project_id, reason, category|gap_type|subject_type)`
  — close a whole cluster of gaps with one shared reason. At least one
  filter is required.

## Cross-references

- SKILL.md `Documentation Graph: callout decision` — the actionable
  decision table and defaults.
- `command_list.md` — full MCP tool API reference (parameters, examples).
- Public guide: `docs/use-cases/documentation-graph.md` (human-facing
  conventions, end-user audience).
