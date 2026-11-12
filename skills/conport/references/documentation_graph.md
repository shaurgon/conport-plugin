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
claims.

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

> [!supersedes] [[doc-<old>]]
> Replaces the older Authentication Guidelines wholesale.

## 1. JWT Validation
...
```

The old document (`doc-<old>`) stays untouched. When a reader opens it with
stub rendering on, every section in it is wrapped with a "moved" stub linking to
`doc-<new>#<section>`, and the original markdown is folded into a `<details>`
collapse for historical reference.

**Resolves — answering an open question.**

```markdown
# Stripe vs Polar — Decision

> [!resolves] [[doc-<id>#open-questions-billing]]
> Closes the billing-provider question raised in doc-<id>.

## Decision
We're going with Polar.
```

The target document's "Open Questions" section gets a "resolved by" stub
above it, with the unmodified questions still visible inline.

**Extends — adding detail to a foundation doc.**

```markdown
# Auto-Reflection Spec

> [!extends] [[doc-<base>]]
> Adds the supersede / dedup runtime on top of Agent Memory Spec.
```

The base doc (Agent Memory, `doc-<base>`) and this doc both stay canonical. Rendering
inserts an "extended by" stub in the base doc's sections that this extension references,
without collapsing them — readers get a discovery hint, not a redirect.

**Relates-to — cross-cutting concern.**

```markdown
# Multi-tenancy + RLS Spec

> [!relates-to] [[doc-<id>]]
> Cross-cutting Security Guidelines (doc-<id>) detail policies; this doc
> details RLS implementation. Both canonical at their layer.
```

Pure backlink — no stub injected. The Referenced-by panel of the linked doc will
show this spec as an incoming relates-to edge.

## Doc-level vs section-level callouts

A callout in the document preamble (before any heading) applies to the
whole document. A callout at the start of a section applies to that
section only.

**One edge between two docs is enough** — you don't need to repeat callouts
per section. So for cross-cutting clusters
(Security ↔ Auth ↔ Multi-tenancy ↔ DB schema), a single doc-level
`[!relates-to]` callout in each specific spec pointing at the cross-
cutting hub links them all.

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

## Doc-graph gaps

Three gaps watch the documentation graph. The server resolves them itself —
there is no manual review queue:

- `dangling_wikilink` triggers when a callout or wikilink target item or
  section anchor doesn't resolve. The server's daily pass removes the link
  markup and keeps the text.
- `malformed_callout` triggers on lines that look like `> [!type] [[...]]`
  but failed to parse (unknown type, missing target). The daily pass turns
  the line into a plain quote.
- `doc_stale_open_question` triggers on an "Open Questions" section that has
  stayed unanswered too long. The user is asked in `init` whether to remove
  the section or keep it open; pass the answer with `answer_question`.

To link two documents that cover the same ground, author the relationship:
edit the right doc and add a callout — the next ingest cycle creates the
document link.

## Spec docs that contain example markup

If the doc you're writing is itself documenting Wave 5 conventions, the
parser ignores fenced code blocks when scanning for callouts and
wikilinks. Examples like `> [!moved] [[doc-<id>]]` inside a ` ```markdown`
block won't be parsed as real edges, so they don't produce false-positive
drift or dangling wikilink gaps.

## Tools

- `get_block_backlinks(project, document_id, [block_ulid], [edge_types])`
  — incoming document links for the doc or one of its blocks.
- `get_semantically_related_blocks(project, document_id, block_ulid, [limit], [threshold])`
  — top-N semantically similar blocks in OTHER docs, excluding already-
  linked targets.
- `get_linked(project, item_type='doc', item_id, include_section_links=true)`
  — combined item-graph + Wave 5 section edges for one document.
- `get_document(project, document_id, raw=false)` — full markdown with
  render-time stubs from incoming supersedes/resolves/extends edges.
  Pass `raw=true` to bypass.
- `gap_list(project, category='doc_drift')` — the open doc-graph gaps,
  read-only.

## Cross-references

- SKILL.md `Documentation Graph: callout decision` — the actionable
  decision table and defaults.
- `command_list.md` — full MCP tool API reference (parameters, examples).
- Public guide: `docs/use-cases/documentation-graph.md` (human-facing
  conventions, end-user audience).
