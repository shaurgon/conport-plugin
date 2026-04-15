# How ConPort handles your data

ConPort is built by one person and aimed at developers who don't want
their project context locked away inside a black box. This page
describes, in plain language, what we store, where it lives, who can
see it, and how to get it out or delete it.

_Last updated: 2026-04-15_

## What we store

When you use ConPort, we store the project context you explicitly send:

- **Projects** — name, description, timestamps
- **Decisions** — summary, rationale, tags
- **Progress entries** — activity log you write
- **Tasks** — titles, descriptions, statuses, dependencies
- **Documents** — full text + version history
- **Patterns** — reusable patterns you record
- **Custom data** — arbitrary category/key/value you add
- **Links** — edges of your knowledge graph
- **GraphRAG entities** — entities we extract from your decisions/patterns/progress to power semantic search

We also generate **embeddings** from your text to make search work.
Embeddings are numeric representations that can leak the gist of the
original text but not reconstruct it verbatim. They're stored in the
same database as the source text.

What we do NOT store:
- Content of files outside the project context you explicitly submit
- Anything from your local filesystem except what you send through the API / MCP
- Analytics on the content of your projects. We use Vercel Analytics
  and Speed Insights on the marketing and dashboard sites for
  aggregate page-view telemetry, not content inspection.

## Where it's stored

- **Primary database:** Supabase-hosted PostgreSQL in the **EU (Frankfurt / `eu-central-1`)** region.
- **Encryption at rest:** enabled by Supabase for all data and backups.
- **Encryption in transit:** TLS for every API call; MCP requests too.
- **Backups:** full encrypted nightly backups to object storage in a
  separate region. Retention is 30 days. Only the encryption key
  holder (the maintainer) can decrypt.

No data is shipped outside the EU for storage or processing.

## Who sees your data

- **You** — via the API, MCP tools, and the dashboard at `me.conport.app`.
- **The maintainer (one person)** — for debugging production issues or
  responding to your support request. These accesses are rare and
  manual; we don't routinely read user content.
- **Supabase** — as the hosting provider, has administrative access to
  the database the same way any managed-Postgres vendor does. Their
  own data handling is described at
  [supabase.com/privacy](https://supabase.com/privacy).
- **Mistral AI** — we use [Mistral](https://mistral.ai) (a French company
  headquartered and processing data in the EU) for two things:
  - **Embeddings** — the text of decisions, tasks, documents, patterns,
    progress entries, and custom data is sent to `mistral-embed` to
    produce the vectors that power search.
  - **Entity extraction** — the text of decisions, patterns, and
    progress entries is sent to `mistral-small-latest` to extract the
    entities that power GraphRAG.
  Mistral's API terms state that API inputs are not used to train their
  models unless you opt in, which we don't.
- **No other third-party LLM or embedding providers** — we do not send
  your data to OpenAI, Anthropic, Google, Cohere, or similar services.

Your data is not used to train models, sold, or shared with
advertisers.

## Authentication and access control

- You log in via Supabase Auth (magic link).
- Every piece of data is tagged with your `owner_id` and enforced at
  the API layer — cross-tenant lookups return 404, not 403, so nothing
  leaks about other users' projects.
- API keys (`cport_live_...`) are issued per account, hashed in
  storage, and revocable from the dashboard.

## Getting your data out (export)

From the dashboard, pick a project and click **Export data**. You'll
get a JSON file containing everything we store for that project:
decisions, tasks, documents (all versions), progress, patterns, custom
data, links, and extracted entities. Embeddings are omitted because
they're huge and not useful to you.

You can also call the API directly:

```
GET https://api.conport.app/api/v1/projects/{name}/export
Authorization: Bearer <your API key>
```

Exports are available on demand, with no rate limit on the first
iteration. We log export calls for our own monitoring but don't share
that log.

## Deleting your data

- **Delete a single project:** Dashboard → project → Settings → Delete,
  or `DELETE /api/v1/projects/{name}`. Deletion is immediate and
  cascades to all related records.
- **Delete your entire account:** Dashboard → Settings → Danger Zone
  → Delete Account. Your account enters **pending deletion** for
  **7 days** (cancel with one click if you change your mind), then is
  permanently purged along with every project you own. Active sessions
  and API keys are revoked immediately when you start the deletion.
- **After you cancel a paid subscription:** data is retained for 30
  days in case you want to come back, then deleted.

No soft-delete graveyard: once the 7-day grace period lapses, the
rows are gone from the database and from the next backup cycle
onward. Older encrypted backups that still contain your data are
rotated out within 30 days.

## Incident response

If we discover a breach that affects your data, we will notify
affected users via the email on file within **72 hours** of
confirming the incident. The notification will describe what happened,
what data was involved, what we've done, and what we recommend you do.
This is the standard GDPR Article 33/34 timeline.

## Cookies and analytics

- `conport.app` (marketing landing) — Vercel Analytics + Speed
  Insights. Aggregate page views, no personal profiling.
- `me.conport.app` (dashboard) — Supabase Auth session cookie and
  Vercel Analytics.
- `api.conport.app` (API) — no cookies, API-key / JWT headers only.

We don't use third-party advertising trackers.

## Changes to this page

Changes are made via public commits to
[github.com/shaurgon/conport-plugin](https://github.com/shaurgon/conport-plugin/commits/main/data-handling.md)
and [github.com/shaurgon/conport-global](https://github.com/shaurgon/conport-global)
so you can see the full history. Material changes are announced in
[Discussions → Announcements](https://github.com/shaurgon/conport-plugin/discussions/categories/announcements)
before they take effect.

## Questions

Open a thread in
[Discussions → Q&A](https://github.com/shaurgon/conport-plugin/discussions/categories/q-a)
or email the address on the landing page. I read every message.
