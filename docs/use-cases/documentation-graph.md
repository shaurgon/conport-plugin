# Documentation Graph & Drift Detection

ConPort treats your project's documents as nodes in a graph: when one spec
extends another, when a runbook supersedes an old guideline, when several
docs touch the same cross-cutting concern, you can encode that relationship
inline in markdown. The platform parses it, renders helpful stubs in the
reader's view, surfaces backlinks, and flags pairs of sections that look
like drift but have no authored relationship yet.

This page is the user-facing convention. Agents (Claude Code, Cursor,
Claude.ai with the connector) follow the same contract via the conport skill.

## The four callouts

Place a callout at the top of a section (or in the document preamble for a
doc-level statement). The first line carries the relationship; subsequent
lines are human-readable rationale that's indexed for search but not part
of the edge.

```markdown
## Authentication

> [!supersedes] [[doc-12#authentication]]
> Reorganized after the Wave 2 redesign — JWT details consolidated here.

(section content)
```

| Callout | Meaning | Render effect |
|---|---|---|
| `[!supersedes]` | This doc/section replaces the linked one. The old text is no longer authoritative. | The target's section gets a "moved" stub; original text is folded into a `<details>` collapse. |
| `[!resolves]` | This doc/section answers an open question stated elsewhere. | The target gets a "resolved by" stub above the original questions. |
| `[!extends]` | Adds detail to the linked doc/section; both remain canonical for their layer. | The target gets an "extended by" stub above the unmodified body. |
| `[!relates-to]` | Soft cross-reference; both authoritative on their own terms. | Backlink only — no inline stub. |

Inline wikilinks in flowing prose (`see [[doc-7#caching]]`) are parsed too,
but they only produce low-weight `relates_to` edges — they show up in the
Referenced-by panel without changing how the target renders.

## Where the callout goes

**Always in the newer / superseding / extending document, never in the
older one.** The older doc stays untouched; readers opening it see the
incoming relationships rendered as stubs at the top of affected sections.

For cross-cutting concerns (Security policy ↔ Auth spec ↔ Multi-tenancy
spec ↔ DB schema spec), put a single doc-level `[!relates-to]` callout in
each specific spec pointing at the cross-cutting hub. One edge between two
docs is enough — drift detection won't re-flag every section pair between
them.

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

- **Referenced by** — incoming `document_links` rows authored by other docs.
  Always visible below the document content.
- **Semantically related** — opt-in (sparkles button). Picks the section
  you point at and finds the closest other docs by embedding similarity,
  excluding sections you've already linked. Useful when writing a new spec
  to spot existing material that touches the same topic.

`search` (REST or MCP) ranks both authored relationships and embedding
similarity together — you don't need a separate query.

## Drift detection

Whenever you save a document, ConPort re-detects four classes of
documentation drift in the background:

| Class | Triggered when |
|---|---|
| `unmarked_supersession` | Two sections in different docs score above the cosine threshold and don't have any `document_links` edge between their docs. |
| `stale_open_question` | A section whose heading matches "Open Questions" is older than 30 days with no incoming `[!resolves]` edge. |
| `dangling_wikilink` | A `[[doc-N]]` or callout target points at a doc/section that no longer exists. |
| `malformed_callout` | A `> [!type] [[...]]` line failed to parse — wrong syntax or unknown type. |

Findings appear as **gaps** under the `doc_drift` category. You can:
- **Author the relationship** — open the newer doc, add a `[!supersedes] /
  [!extends] / [!relates-to]` callout. The next save closes the gap.
- **Dismiss with a reason** — when both docs are authoritative on their
  own layer, use Dismiss in the gap UI (or `gap_dismiss` MCP tool) with a
  short rationale. The dismissal sticks across re-detection.

## Migration: onboarding an existing project

If you're adopting documentation graph for a project that already has a
backlog of docs, you'll typically have several hundred candidate drift
pairs on the first detection run. The recommended flow:

1. Group candidates by document pair (a single `(docA, docB)` pair often
   represents 5–20 section-level matches).
2. For each pair, decide one edge type. Single doc-level callout in the
   right doc covers all section-pair matches between them.
3. Archive deprecated docs entirely (`status='archived'`) — they're
   automatically excluded from drift detection.
4. Use Dismiss with reason for genuine cross-cutting clusters where both
   docs remain canonical.
5. Re-trigger detection — surviving pairs are real candidates that need
   per-section attention.

Expect ~2 advisory hours for a 25-doc corpus.

## Threshold tuning

Drift detection is conservative by default — it emits only pairs above a
cosine similarity of 0.90, with the high-severity bucket starting at 0.95.
For a project with a tight thematic corpus (one knowledge area), even 0.90
can be too low; for a project spanning many domains, you may want to drop
it to 0.85 to surface earlier hints. Per-project overrides live in
`custom_data.gap_thresholds`.

## What's not covered (yet)

- **Cross-project wikilinks** (`[[project-X/doc-Y]]`) — reserved syntax,
  not parsed yet.
- **Synced blocks** (Notion-style live mirrors) — not designed for; use
  `[!extends]` to cross-link instead.
- **Visual graph view** — surface is data-side only for now; pgvector
  cosine + REST endpoints are stable, frontend graph UI is a follow-up.
- **Semantic LLM-aided drift detection** — current detector is mechanical
  (embedding cosine); LLM augmentation for borderline cases is on the
  roadmap.
