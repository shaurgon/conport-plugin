# Documentation Graph & Drift Detection

ConPort treats your project's documents as nodes in a graph: when one spec
extends another, when a runbook supersedes an old guideline, when several
docs touch the same cross-cutting concern, you can encode that relationship
inline in markdown. The platform parses it, renders helpful stubs in the
reader's view, surfaces backlinks, and repairs or asks about the documentation
gaps it finds.

This page is the user-facing convention. Agents (Claude Code, Cursor,
Claude.ai with the connector) follow the same contract via the conport skill.

## The four callouts

Place a callout at the top of a section (or in the document preamble for a
doc-level statement). The first line carries the relationship; subsequent
lines are human-readable rationale that's indexed for search but not part
of the edge.

```markdown
## Authentication

> [!supersedes] [[doc-<id>#authentication]]
> Reorganized after the Wave 2 redesign — JWT details consolidated here.

(section content)
```

| Callout | Meaning | Render effect |
|---|---|---|
| `[!supersedes]` | This doc/section replaces the linked one. The old text is no longer authoritative. | The target's section gets a "moved" stub; original text is folded into a `<details>` collapse. |
| `[!resolves]` | This doc/section answers an open question stated elsewhere. | The target gets a "resolved by" stub above the original questions. |
| `[!extends]` | Adds detail to the linked doc/section; both remain canonical for their layer. | The target gets an "extended by" stub above the unmodified body. |
| `[!relates-to]` | Soft cross-reference; both authoritative on their own terms. | Backlink only — no inline stub. |

Inline wikilinks in flowing prose (`see [[doc-<id>#caching]]`) are parsed too,
but they only produce low-weight `relates_to` edges — they show up in the
Referenced-by panel without changing how the target renders.

## Where the callout goes

**Always in the newer / superseding / extending document, never in the
older one.** The older doc stays untouched; readers opening it see the
incoming relationships rendered as stubs at the top of affected sections.

For cross-cutting concerns (Security policy ↔ Auth spec ↔ Multi-tenancy
spec ↔ DB schema spec), put a single doc-level `[!relates-to]` callout in
each specific spec pointing at the cross-cutting hub. One edge between two
docs is enough — there is no need to repeat it in every section.

## Anchors and wikilinks

Wikilinks have the form `[[doc-N]]`, `[[doc-N#anchor]]`, or
`[[decision-N]]`. The anchor after `#` matches one of:

1. An explicit `^id` you placed after a heading: `## Authentication ^auth-flow`
2. The kebab-slug of the heading text: `## Authentication` → `authentication`

If a section anchor is critical (other docs will wikilink it), pin it with
an explicit `^id`. Without one, the anchor is heading-derived: stable
across edits to the body, but it changes if you rename the heading.

## Discovering relationships

Two surfaces in the dashboard help you find existing connections:

- **Referenced by** — incoming document links authored by other docs.
  Always visible below the document content.
- **Semantically related** — opt-in (sparkles button). Picks the section
  you point at and finds the closest other docs by embedding similarity,
  excluding sections you've already linked. Useful when writing a new spec
  to spot existing material that touches the same topic.

`search` (REST or MCP) ranks both authored relationships and embedding
similarity together — you don't need a separate query.

## Documentation gaps

Whenever you save a document, ConPort checks the documentation graph in the
background. What it finds becomes a **gap** under the `doc_drift` category, and
the server settles it — there is no queue to review by hand:

| Gap | Triggered when | What happens |
|---|---|---|
| `dangling_wikilink` | A `[[doc-N]]` or callout target points at a doc/section that no longer exists. | The server's daily pass removes the link markup and keeps the text. |
| `malformed_callout` | A `> [!type] [[...]]` line failed to parse — wrong syntax or unknown type. | The daily pass turns the line into a plain quote. |
| `doc_stale_open_question` | A section whose heading matches "Open Questions" has stayed unanswered too long. | Your agent asks you at the start of a session whether to remove the section or keep it open. |

To relate two documents that cover the same ground, author the relationship:
open the newer doc and add a `[!supersedes]` / `[!extends]` / `[!relates-to]`
callout.

## What's not covered (yet)

- **Cross-project wikilinks** (`[[project-X/doc-Y]]`) — reserved syntax,
  not parsed yet.
- **Synced blocks** (Notion-style live mirrors) — not designed for; use
  `[!extends]` to cross-link instead.
- **Visual graph view** — surface is data-side only for now; pgvector
  cosine + REST endpoints are stable, frontend graph UI is a follow-up.
