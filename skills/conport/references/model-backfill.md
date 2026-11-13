# Filling the model of an existing project

A project that lived before its model has documents and code, but no model of
them. This procedure builds that model: today's structure taken from the code,
history and reasons taken from the documents, decisions attached to entities,
the planned told apart from the built, and nothing outdated looking current.
It is a procedure of this skill: no command of the plugin and no tool of its
own runs it. The rules of a portion — types, fields, scenarios, refusals — are
the section *PROJECT MODEL* of the skill; this file says only what the backfill
adds.

## The frame

Six steps, in this order:

| Step | What is done | Done when |
|---|---|---|
| 1. Skeleton | The entities of the code, unit by unit, submitted as `code:<unit-name>` sources; the anchor check run | Every unit of the list has its source; the anchor check ran |
| 2. Inventory | Every document of the project gets a role; types, `supersedes` links, links to epics and disputed dates are corrected | The user's approval is recorded; every document of the inventory has a role |
| 3. Pass | The documents with a role submit their portions, oldest first | No debt `no_portion` is left |
| 4. What is gone | Things of the documents not found in the code are marked by the portion of the result document | The result is submitted and the user has read it |
| 5. Decisions | Every active decision is attached to an entity | Every active decision is attached, or named in the result as not about the structure |
| 6. Debts | The debts of the model are cleared | `arch_backfill(project, state='completed')` is accepted |

- **One backfill session per project.** To resume, read the state of the
  backfill (`arch_status`), the inventory document, the list of portions
  (`arch_sources`) and the debts: they show which step runs and which
  documents are submitted.
- **The session of the project fills it**, in the project's repository. A
  project of several repositories is out of the procedure's scope: it runs on
  one repository.
- **Approval.** At every step below where something is approved, the user of
  the project approves it, by their word in the session. The backfill of a
  project of another team is approved by a user of that team.
- **Documents are not rewritten.** A document created after the inventory is
  approved is not part of the backfill: it lives by the ordinary rules of the
  model.
- **The cost.** Every document portion is reviewed before it is submitted,
  on the user's side: up to two reviewer runs per document on the user's
  model, not counted in the usage of the team; step 3 starts with an
  estimate for the user.

## Step 1. Skeleton

**A unit** is found by its version file: `pyproject.toml`, `package.json`,
`plugin.json`, `orca-plugin.json`, `Cargo.toml`, `go.mod`.

- A directory with a version file is a unit.
- A version file in a directory whose name starts with a dot (`.claude-plugin/`,
  `.cursor-plugin/`) makes its parent directory the unit.
- A `package.json` with `workspaces` whose directory holds no files of its own
  besides nested units and service files (`package.json`, lock files,
  `.gitignore`, `.npmrc`, `README*`, `LICENSE*`, `CHANGELOG*`) is the root of a
  workspace, not a unit.
- A version file under a path of the noise does not count (dependencies,
  builds, tests: `node_modules/`, `dist/`, `test/`, `tests/` and the like).
- A file belongs to the deepest unit.
- The files outside every unit make up the root (`code:root`).

`npx -y conport@^0.11.0 arch suggest --json` applies this rule to the tree of
`HEAD` and proposes the units with their labels, the parts of each unit — its
hot directories over the whole history of commits, and with a `codegraph`
index also the large ones — and, with that index, the imports between the
parts of one unit; with a project and its server it marks the candidates the
model already covers. It reads the history of git, the `codegraph` index when
there is one and, for the marks, the server; it submits nothing: the list is a
proposal, checked against the code like any other. The list of units with their labels is the first
table of the inventory (step 2) and is approved with it; until then the
skeleton is submitted by the proposed list.

**The label** of a unit's source is `code:<unit-name>`: lower case, no `/` —
the unit `cli/conport` → `code:cli-conport`. A unit with more than 400
entities is split into `code:<unit-name>.<part>` sources; the portion with the
unit itself goes first.

**What is written out** — read the code through `codegraph` or the files:

- units and their parts — top-level packages and modules, no deeper than two
  levels; the parts `arch suggest` proposes are where the history of the unit
  goes;
- interfaces — only external ones, and by groups: the routes of one REST
  section are one entity anchored at their routes file, the tools of one MCP
  module are one entity, the commands of one CLI group are one entity. An
  interface is an entity of its own only when a document or a scenario names
  it;
- stores and data — databases and their tables;
- settings — the environment variables and flags the code reads;
- external systems — what the code reaches over the network or by starting a
  process;
- scenarios the code itself records (the part *Scenarios* of the skill), with
  an anchor.

**Anchors.** Every entity of the skeleton carries a `path` or `symbol`
anchor, or it stays declared after the anchor check: a table — `table` and the
`path` of the migration that created it; a setting — the `symbol` of its
settings field or the `path` of the file that reads it.

**Relations of the skeleton** — `contains`, and only those `calls`, `reads`
and `writes` the code shows: `calls` — a direct import and call between parts,
or a call to an external system through a client with a set address; `reads`
and `writes` — an SQL statement naming the table in the code of the part. A
relation through dependency injection, a queue or a name in a setting is not
submitted: the documents bring it.

**The count.** Check the count against the code: tables against the
migrations, routes against the API description or the route files, tools
against their registry. A difference goes into the inventory.

**After every `code` portion** run `npx -y conport@^0.11.0 arch check` in the
repository root. A skeleton submitted earlier grows by submitting the same
source again: read it with `arch_source`, add to it, submit it. No tool of its
own builds the skeleton: it is this step.

**A project without local code** (documents only) skips steps 1 and 4: a thing
without code stays planned, and nothing is checked against the code.

## Step 2. Inventory

**The inventory** is a ConPort document "Model backfill: inventory", type
`other`, role `none`, with two tables:

1. Units: directory, label, number of entities of the skeleton, differences of
   the count.
2. Documents: number, date of creation, type, new type, role, reason,
   replaces, epics.

**The role.** Every document of the project gets a role; no role is set
automatically:

- `structure` — describes what exists now;
- `history` — describes what has already been replaced;
- `none` — ideas, audits, runbooks, notes, plans and text drawn from other
  records.

Set the role by a quick read — the headings and the opening of each section —
and by checking the things the document names against the code: a document
whose things are not in the code is a candidate for `history`. The full read
comes in the pass. A `runbook` document gets the role `none`; when it
describes how the system is built, give it a new type first, then the role.

**Corrections on the way, all before the first portion of the document:**

- a wrong type — the column "new type". A new type other than `spec` or
  `architecture` withdraws the portion of a document without a role, so for a
  document without a role that already has a portion: write its role first,
  then change its type;
- "replaces" — a `supersedes` link from the newer document to the older one:
  `link_items(project, source_type='doc', source_id=<new>, target_type='doc', target_id=<old>, relationship='supersedes')`.
  It does not touch the model: it hints at the role and at what replaced what;
- the epic — propose the missing `clarifies` links from the document to its
  epic, from the document's links to tasks; a document without an epic stays
  so;
- a disputed date — a document whose date in its title or text differs from
  its date of creation goes into a list with the proposed date. The user
  approves the list with the inventory; the operator of the server sets the
  dates before the pass. When the user has no access to the operator of the
  server, no step waits for it: the pass goes by the current dates of
  creation, and the result names the documents with disputed dates in one
  line. The order of the model follows the date of creation.

**Approval.** The user approves the inventory by their word, as a whole or
after rows are edited. Then record the decision with `sync_decision`, write
the roles —
`update_document(project, document_id, model_role='structure' | 'history' | 'none')`
for each document — and right after that call
`arch_backfill(project, state='in_progress')`. Writing a role does not start
the backfill: only that call does.

**What a role does to a portion:**

- The role `none` on a document with a portion withdraws that portion.
- The role `history` on a document with a portion keeps the portion and
  deletes the scenarios of that portion: a history source carries no
  scenarios.
- The role `structure` on a document with a portion keeps it; a change between
  `structure` and `history` recomputes the model.
- A change of type on a document with the role `structure` or `history`
  leaves its portion alone; a document without a role that already has a
  portion loses it to a type other than `spec` or `architecture` — the
  correction above writes the role first.
- A wrong role is corrected to the right one; never empty it.

## Step 3. Pass

**Before the pass** tell the user the estimate: the number of documents with
a role, their total length in characters, and up to two reviewer runs per
document on the user's model. `content_length` of `list_documents` counts
bytes — one to four per character, two for a Cyrillic letter — so the sum of
`content_length` bounds the total length from above: give it as "at most N
characters".

**The order** — by date of creation, then by number.

**The review.** Every document portion is reviewed before it is submitted,
in the order of the part *The review of a document portion* of the skill's
section *PROJECT MODEL*: the input directory
(`npx -y conport@^0.11.0 arch review-input doc-N --portion <draft> -o <dir>`),
the reviewer, every finding fixed or dismissed with a reason, one recheck
when something was fixed, and the portion submitted with `review`. A long
document is reviewed like any other: the reviewer reads it block by block.
When the reviewer fails twice on a document, submit the portion without
`review`, tell the user, and go on with the pass: the portion owes
`unchecked_portion`, and the result names it.

**A thing of the document** is looked for in the code (`codegraph` or the
files), not only in the skeleton: the skeleton is two levels deep. Found —
name the entity of the skeleton by its name, or introduce a new one with an
anchor. Not found — submit it without an anchor; step 4 decides its fate.

**A history source** (role `history`) submits entities and relations, and no
scenarios. Its claims set no current state: they go into the history of the
card. A portion of a document with the role `history` that carries a
non-empty `scenarios` is refused `scenario_malformed` by the rule
`history_source`; its action: Submit the portion of a document with the role
history again without the field `scenarios`. The reviewer raises no
whole-scenario finding for such a document.

**Two documents of the structure contradict each other** — the later one
wins. When the code says otherwise, the correction is a `changed` claim in the
result document (step 4), and the contradiction goes into its table.

**Limits:**

- A document that yields more than 150 entities or 30 scenarios: the portion
  carries the top level, and the rest goes into the row "did not fit" of the
  result.
- A document with nothing to extract submits an empty portion: it closes the
  debt.

**Decisions on the way.** A portion names the decisions its document refers
to — the document's links to decisions and the numbers in its text — in
`decisions` of the entity.

## Step 4. What is gone

**The result document** is "Model backfill: result", type `other`, role
`structure`, created after the pass so that it comes last in the order of the
model. More than 150 entities — "Model backfill: result 2" and on. It is the
source of the claims no document grounds: the ground of each claim is the
block of the table of the result that holds its row.

**A thing a document introduced, not found in the code, and removed by no
document:**

- the document `clarifies` an epic neither `DONE` nor `CANCELLED` — planned;
  no claim;
- a document with the role `structure`, active, not replaced by a
  `supersedes` link and without an epic — planned; it goes into the table
  "without epic and without code" for the user to read;
- otherwise — gone: the portion of the result claims it `removed` with the
  reason "not found in code", or `replaced` with `replaced_by` when the
  skeleton has the entity that replaced it.

The user is not asked about each one: the user reads the result as a whole; a
row they disagree with is edited, and the portion of the result is submitted
again.

**A document submitted again after this step** claims a relation to a removed
entity with the action `removed`, and submits a scenario without the removed
participant or with the one that replaced it.

## Step 5. Decisions

The active decisions without an entity are the key `unlinked_decisions` of
`arch_status` while the backfill runs: `total`, `ids` and `next_after`. Read
it page by page — the next call is
`arch_status(project, unlinked_after=<next_after>)` — until `next_after` is
null — that page is the last, even when its `ids` are not empty.

For each decision look for the entities by the names and aliases in its text
and by `search`, and attach it in the portion of the result: the decision's
number in `decisions` of the entity, with the action `mentioned`. A decision
not about the structure is a row of the table "decisions without an entity".

## The tables of the result

| Table | Columns |
|---|---|
| 1. **Removed and replaced** | entity, type, introduced by document, action, replacement, reason |
| 2. **Without epic and without code** | entity, type, document |
| 3. **Contradictions of documents** | entity, documents, what they say, what the code says |
| 4. **Did not fit** | document, what did not fit into its portion |
| 5. **Unchecked portions** | document, why its portion went without a review |
| 6. **Decisions without an entity** | decision, why it is not about the structure |
| 7. **Trust summary** | the number of entities, the share of built entities, the number of removed entities, the number of unchecked portions (submitted without a review), the number of documents without an epic, the number of decisions without an entity |

When the dates were not set before the pass: one line naming the documents
with disputed dates, from the list of the inventory (step 2).

## Step 6. Debts

Clear the debts `arch_status` lists, each by its action, down to zero. Then
call `arch_backfill(project, state='completed')`. A refusal
`backfill_not_ready` names what blocks the completion in `blockers`; clear
each item and call again:

- `debts` — the model still owes work: clear the debts of `arch_status`. A
  document portion submitted without a review owes `unchecked_portion` like
  any other debt: run the reviewer on the portion and submit it again with
  `review`;
- `code_source_unchecked` — a `code` source was submitted after the latest
  anchor check: run `npx -y conport@^0.11.0 arch check`.

## Refusals

| Code | When | Do exactly this |
|---|---|---|
| `backfill_not_ready` | `completed` while a debt of the model or a `code` source newer than the anchor check is left; `blockers` names each | Clear each item of `blockers` by its kind, as the backfill procedure says, then repeat the call. |
| `backfill_not_started` | `completed` before the backfill started | Start the backfill first: arch_backfill with state 'in_progress', right after the inventory is approved. |
| `backfill_already_started` | `declined` after the backfill started | The backfill has started and cannot be declined; leave its state as it is and go on with the session's work. |

## Rollback

The rollback runs only on the user's word, never as a step of your own; no
refusal prescribes it. `npx -y conport@^0.11.0 arch withdraw --all` shows what
would be removed — without `--apply` it removes nothing. With `--apply` it
withdraws every source of the project, documents and code alike: the state of
the backfill returns to the start. The roles, types and links of the documents
stay; the attachments of decisions to entities are removed with the entities,
and step 5 attaches them again on the next pass.

## After the backfill

In a project whose model has `code` sources: merge an epic that changed the
code into the main branch with `--no-ff`, then run
`npx -y conport@^0.11.0 arch check` in the repository root on that branch.
For each debt `code_portion_stale` it brings, read the paths its `detail`
names, bring the portion in line with the code and submit it again — as it is
when the model does not change. The debt sees files added, deleted and
renamed, not what changed inside a file: when the epic changed what a unit is
made of in its existing files, submit the portion of that unit again too.
After the last submission run the check once more: a `code` portion newer
than the check owes `check_stale`. A debt `area_uncovered` asks for a hot
directory no entity is anchored in: describe it in the portion of its unit
with an anchor `path`, or add it to `arch.ignore` with its reason.
