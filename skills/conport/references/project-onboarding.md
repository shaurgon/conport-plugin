# Onboarding an existing project

A project that lived for long without ConPort — no specs, often no documents
at all, only code and the history of git — is connected to ConPort by this
procedure. It ends with a project that ConPort knows: a product context, an
overview approved by the user, the model of its structure, a chronicle of its
history, the decisions that can be recovered and the documents of the
repository. It is a procedure of this skill: no command of the plugin and no
tool of its own runs it. It leans on the backfill of the model
(`references/model-backfill.md`) for the skeleton of the code and for the
model of the documents.

## The frame

Eleven steps, in this order:

| Step | What is done | Who | Done when |
|---|---|---|---|
| 0. Entry | The project exists; the repository has history; the CLI answers; the state is `in_progress`; the draft is created | you | The state is `in_progress` and the CLI answers |
| 1. Interview 1 | Up to seven questions in one message | the user | The answers are in the draft |
| 1a. Earlier records | What the user called no longer valid is marked | you | Everything the user named is marked |
| 2. Documents | The inventory of the `.md` files of the repository and their upload | you, the user | The inventory is approved and the files are uploaded |
| 3. Skeleton | `code:<unit>` portions of the code and the anchor check | you | The portions are submitted and the check ran |
| 4. History | The stages of git and a retelling of each | you | The retelling of every stage is in the draft |
| 5. Interview 2 | The questions the history left open | the user | The answers are in the draft |
| 6. Approval | The whole draft: context, overview, chronicle, decisions | the user | Approved by the user's word |
| 7. Writing | Chronicle, decisions, overview, links, contexts | you | Everything is written |
| 8. Model from the documents | The backfill from its step 2 | you, the user | `arch_backfill` is `completed` |
| 9. Summary | `onboarded_at`, the state `completed`, the report | you | The state is `completed` |

- **What the user sees first.** In a session with a person `init` gives one
  of three lines in `instructions`, the server's own words:
  - `Project onboarding: this project is empty — if the repository has history, offer the user to connect it by the onboarding procedure of the conport skill; if they decline, call project_onboarding(project, state='declined').`
    Show the offer once.
  - `Project onboarding in progress — resume it by the onboarding procedure of the conport skill from the step its draft names; if the user no longer wants it, call project_onboarding(project, state='declined') — what is written stays.`
    You lead it: resume from the step of the draft (*Draft and resume*).
  - `Project onboarding in progress, led by another member of this team — do not start another; take it over only on the user's word.`
    Someone else leads it: do not start a second one.
- **The key `onboarding`** of `init` carries `state` (`not_started`,
  `in_progress`, `completed`, `declined`), `offer` (the project is not
  onboarded: no product context or an empty one, no portion of the model,
  state `not_started`) and `lead_is_caller` (true when you lead it, false when
  another member does, null when nobody does). The decisions, progress
  entries, documents and tasks a project already has do not count: a project
  with them can still be offered.
- **Explicit start.** The user can ask to onboard the project at any moment
  until it is `completed`, a declined one included. After `completed` there is
  no second onboarding: the project is worked on like any other.
- **Every step that writes** names the MCP call and the form of the CLI
  (`npx -y conport@^0.15.0 api …`), so an agent without the MCP server runs it
  too.
- **The user approves** what a step asks to approve, by their word in the
  session.

## Step 0. Entry

1. **The project.** No `.conport.json`, or `init` answers `project_not_found`:
   with the user's consent create the project with
   `create_project(name, description?)`, or
   `npx -y conport@^0.15.0 api projects create --name <name>` (with
   `--team-id <team ID>` for a shared team) — by the user's word — write its
   handle into `project_name` of `.conport.json` and go on. A refusal `project_limit_reached` has one
   action: `change the plan or free a project`.
2. **The repository.** The server sees no local code, so check it yourself:
   the root is a repository of git; a shallow clone has one action,
   `git fetch --unshallow`; the first-parent line of the main branch has at
   least 20 commits and the first of them is older than 30 days. Not a
   repository, or almost no history: instead of the onboarding run the first
   fill, `references/bootstrap.md` without its own condition. It writes the
   product context, and the offer goes away by itself.
3. **The CLI.** Read the state of the onboarding,
   `GET /api/v1/projects/{project}/onboarding`, with
   `npx -y conport@^0.15.0 api arch onboarding --project <project>` (the name
   of the operation is the one `npx -y conport@^0.15.0 api --help` builds from
   the server). No Node.js or no key gives one action:
   `put CONPORT_API_KEY in the environment or in ~/.config/conport/.env`. The
   CLI does not see the key of the plugin of Claude Code.
4. **Advice that blocks nothing.** No `plugins.superpowers` in
   `.conport.json` — offer to turn the Superpowers overlay on; no `codegraph`
   index of the repository — offer to build it. One action each; the
   onboarding goes on whatever the user answers.
5. **The state.** `project_onboarding(project, state='in_progress')`, or
   `npx -y conport@^0.15.0 api arch onboarding-put --project <project> --state in_progress`.
   It makes you the lead.
6. **The draft.** Create `.conport/onboarding/draft.md` (*Draft and resume*)
   and write the step into it.

## Step 1. Interview 1

One message, at most seven questions, in the user's language:

1. What ConPort already holds about the project (decisions, documents — list
   them): is each still valid?
2. What is the project, and for whom?
3. Which parts of the repository matter, and which must not be touched? The
   paths not to read become `--ignore` of step 4.
4. From when is the history of interest? The date becomes `--since` of step 4.
5. Documents outside the repository: where are they? A `.md` file the user
   hands over goes into the inventory of step 2.
6. Other repositories of the product (*Several repositories*).
7. What is in progress now?

Write the answers into the draft. A question the user skips stays open; do not
answer it yourself.

## Step 1a. Earlier records

What the user called no longer valid is marked, nothing is deleted:

- a decision — `deprecate_decision(project, decision_id, reason=<the user's words>)`,
  or `npx -y conport@^0.15.0 api decisions deprecate --project <project> --decision_id <N> --reason <the user's words>`;
- a document — the status `archived`:
  `update_document(project, document_id, status='archived')`, or
  `npx -y conport@^0.15.0 api documents replace --project <project> --document_id <N> --status archived`.

Progress entries are not changed. Write what you marked into the draft; the
summary names it.

## Step 2. Documents

The file of the repository is the truth of a document; the document of
ConPort is its copy as of the upload. A file changed after its upload is not
uploaded again — its title is taken, and the CLI refuses another body under
it. Renew the document in place with the file's body:
`update_document(project, document_id, content=<the file's body>)`, or
`npx -y conport@^0.15.0 api documents replace --project <project> --document_id <N> --content "$(cat '<file>')"`.
A `spec` is renewed as an amendment with its reason: add
`--change_kind amend --reason '<why>'`, or pass `change_kind='amend'` and
`reason` to `update_document` (live docs `projects/spec-append-only`). A file
larger than about 128 KiB does not fit one argument of a command on Linux:
renew it through MCP `update_document`.

**The inventory.** Every `.md` file outside the noise (README, `docs/`, ADRs
and the like) and every `.md` file the user handed over, each with:

- the proposed type — `spec`, `architecture`, `runbook`, `api_docs`,
  `tutorial`, `meeting_notes`, `plan` or `other`;
- the title — the first `#` heading of the file; when it has none, or the
  heading repeats in the inventory or in the project,
  `<path>: <H1 or file name>`;
- the date of its first commit — the oldest line of
  `git log --diff-filter=A --follow --format=%cI -- <file>` (a date with its
  time zone).

A file of another format (`.mdx`, `.rst`, `.adoc`) is a row "not uploaded:
format". A document the project already has is not uploaded again: it goes
into the inventory of the backfill (step 8) as it is. The user approves the
inventory by their word, as a whole or after rows are edited.

**The upload**, file by file:
`npx -y conport@^0.15.0 documents upload <file> --doc-type <type> --title <title> --created-at <date>`.
No `.md` file in the repository and none handed over: the step is empty. Write the number
of each uploaded document into the draft.

## Step 3. Skeleton

Step 1 of `references/model-backfill.md`, run here:
`npx -y conport@^0.15.0 arch suggest --json` proposes the units, a
`code:<unit>` portion is submitted for each unit, and
`npx -y conport@^0.15.0 arch check` runs in the repository root after them.
The step is skipped only when a decision of the project itself keeps the code
out of the model and the user called it valid in interview 1 (*Several
repositories*); the draft says so.

## Step 4. History

**The table of contents.** Take the tip of the main branch:
`git symbolic-ref refs/remotes/origin/HEAD`, without a remote `main` or
`master`. Work not merged into it is not part of the chronicle. Run
`npx -y conport@^0.15.0 history --to <tip of the main branch> --json`, with
`--since <YYYY-MM-DD>` and `--ignore <path>` (as many as needed) from
interview 1. The answer lists the stages and prints the full hash `to`. Write
the arguments and the table into the draft and to the server:
`project_onboarding(project, state='in_progress', history={to, since, ignore})`,
or `npx -y conport@^0.15.0 api arch onboarding-put --project <project> --state in_progress --history '{"to": "<to>", "since": <since>, "ignore": <ignore>}'`,
where `<since>` is the date of `--since` in quotes (`null` without it) and
`<ignore>` is the list of the paths of `--ignore` (`[]` without them) — the
arguments exactly as the table was read with, so a resume on another machine
gets the same stages.

Before the first stage tell the user the number of stages and of commit
messages and warn that the model of your agent reads the commit messages
(*Cost*).

**Each stage.** Run
`npx -y conport@^0.15.0 history --stage N --to <to> --json` for N from 1 to
the last, with the same `--to`, `--since` and `--ignore` on every call, so new
commits between sessions do not move the stages. The summary of a stage gives
its dates, units, hot areas, the folders that appeared and went, the tags and
up to 200 commit messages. For each stage write into the draft: the
retelling, the candidate decisions (a choice the messages show with its
reason) and the questions the stage leaves open (a turn without an
explanation).

**The border of git.** Only your retelling goes into ConPort: what changed
and why, with dates, short hashes and tags. The raw commit messages, the
names and the e-mails of their authors are never written. The retelling
carries no names of people and nothing that looks like a secret: keys,
passwords, tokens and internal addresses from the messages stay out of it.
The chronicle and the decisions are shown to the user before they are written
(step 6).

## Step 5. Interview 2

The questions the history left: turns without an explanation, and what of
the found is no longer valid. One message; the answers go into the draft. A
reason the user gives is a decision with the label `from-owner`; a choice the
user calls cancelled is deprecated when it is written (step 7).

## Step 6. Approval

Show the whole draft: the product context and the active context, the
overview, the chronicle stage by stage, the decisions with their labels and
what they replace. The user edits and approves it by their word. Nothing is
written before that.

## Step 7. Writing

In this order; after each batch write the numbers of what was written into the
draft.

### The chronicle

One progress entry per stage. Its title is
`Stage N: <gist>, <month> – <month> <year>`, in the user's language; its
`created_at` is the date of the last commit of the stage; its text says what
changed and why, the units, the range of hashes `first..last` and the tags.
The entries go in batches of up to 100 —
`POST /api/v1/projects/{project}/batch/progress`, run as
`npx -y conport@^0.15.0 api batch progress --project <project> --items '<json array>'`
with `title`, `description` and `created_at` of each entry. The MCP tool
`log_progress(project, description, title)` writes an entry without a past
date: use it only when the CLI cannot run. Each entry is linked to the entities
of its units: `link_items(project, source_type='progress', source_id=<N>, target_type='entity', target_id=<entity>, relationship='mentions')`,
or `npx -y conport@^0.15.0 api links create --project <project> --source_type progress --source_id <N> --target_type entity --target_id <entity> --link_type mentions`.

### The decisions

- Run `search` over the decisions of the project before writing each one: a
  decision the project already has is not written again; its entry of the
  chronicle is linked to it instead.
- The labels: `project-onboarding` and one of `restored-from-git` (the reason
  is in the history) or `from-owner` (the user gave it in interview 2).
- In batches of up to 100, with the `created_at` of the stage where the
  choice shows — `POST /api/v1/projects/{project}/batch/decisions`, run as
  `npx -y conport@^0.15.0 api batch decisions --project <project> --items '<json array>'`.
  The MCP tool `sync_decision(project, summary, rationale, tags)` writes one
  without a past date: use it only when the CLI cannot run.
- A decision cancelled by a later stage or by the user is deprecated after it
  is written — `deprecate_decision(project, decision_id, reason)` or
  `npx -y conport@^0.15.0 api decisions deprecate --project <project> --decision_id <N> --reason <reason>` —
  and the newer one is linked to it with `supersedes`:
  `link_items(project, source_type='decision', source_id=<new>, target_type='decision', target_id=<old>, relationship='supersedes')`,
  or `npx -y conport@^0.15.0 api links create --project <project> --source_type decision --source_id <new> --target_type decision --target_id <old> --link_type supersedes`.
- After they are written, attach them to the entities of the model:
  `update_decision(project, decision_id, entities=[<names>])`. Without the
  MCP server, step 8 attaches them through the portion of the result (the
  decision's number in `decisions` of the entity). A deprecated decision is
  named in step 8 as not about the current structure.

### The overview

A document of type `architecture`, titled `Project overview <name>`, dated
today, with five sections:

1. **The product** — what it is and for whom; documents outside the
   repository the user named, as links.
2. **What it is made of** — by units of the code; what matters and what must
   not be touched (interview 1).
3. **How it developed** — briefly, stage by stage, with links
   `[[progress-N]]` to the entries of the chronicle.
4. **What is in progress now.**
5. **Neighbouring repositories of the product** — with links to their
   projects (*Several repositories*).

It is written after the chronicle, so section 3 carries the numbers of the
written entries:
`add_document(project, title, content, doc_type='architecture')`, or
`npx -y conport@^0.15.0 documents upload <file> --doc-type architecture --title "Project overview <name>"`
from a file kept next to the draft. Each document uploaded in step 2 is linked
from the overview with `references`:
`link_items(project, source_type='doc', source_id=<overview>, target_type='doc', target_id=<N>, relationship='references')`,
or `npx -y conport@^0.15.0 api links create --project <project> --source_type doc --source_id <overview> --target_type doc --target_id <N> --link_type references`.

### The contexts

- **The product context** — one request,
  `PATCH /api/v1/projects/{project}/context/product`:
  `npx -y conport@^0.15.0 api context update --project <project> --context_type product --patch '{"vision": "…", "tech_stack": "…", "target_users": "…", "goals": "…"}'`.
  A field nothing told is not written: not the code, not the README, not the
  interviews. The MCP tool `update_product_context(project, field, value)`
  writes one field per call and takes `vision`, `goals`, `features`,
  `architecture`, `tech_stack` and `constraints` only.
- **The active context** — the answer "what is in progress now":
  `update_active_context(project, field='current_focus', value=<answer>)`, or
  `npx -y conport@^0.15.0 api context update --project <project> --context_type active --patch '{"current_focus": "…"}'`.
- **The neighbours** — `link_project` by *Several repositories*.

## Step 8. Model from the documents

The backfill of `references/model-backfill.md` from its step 2: the inventory
of roles, the pass, what is gone, the decisions attached to entities, the
debts. The overview takes the role `structure`. Without documents of the
repository the inventory holds the overview alone. The step ends when
`arch_backfill(project, state='completed')` is accepted. While the onboarding
is `in_progress`, `init` gives no line offering the backfill: this step runs
it.

## Step 9. Summary

1. **The mark** `onboarded_at` — a second request to the product context,
   `npx -y conport@^0.15.0 api context update --project <project> --context_type product --patch '{"onboarded_at": "<YYYY-MM-DD>"}'`.
   No MCP tool writes this field: `update_product_context(project, field, value)`
   takes only the fields named in step 7.
2. **The state.** `project_onboarding(project, state='completed')`, or
   `npx -y conport@^0.15.0 api arch onboarding-put --project <project> --state completed`.
   A refusal `onboarding_not_ready` names in `blockers` what is left
   (*Refusals*).
3. **The report** to the user, part by part: the product context and the
   active context; the overview; the model and its backfill; the chronicle
   with the dates of its stages; the decisions, those marked deprecated
   among them, and the earlier records marked in step 1a; the documents with
   their dates and roles; the stages written with hashes the history no
   longer has; one action per neighbouring repository (*Several
   repositories*).
4. **The draft.** The summary deletes the draft and its folder.

## Draft and resume

- **The draft** is `.conport/onboarding/draft.md`. When you create the folder,
  put a `.gitignore` holding the line `*` in it. The draft holds the number of
  the step, the answers of the interviews, the arguments of `history`, the
  table of stages, the retellings, the candidate decisions, the draft of the
  overview and the numbers of what was written.
- **Where it is.** Look in the current working copy, then in the main one —
  the parent of `git rev-parse --git-common-dir` — so a resume from another
  worktree finds it.
- **Resume** — on the line of `init` for the lead,
  `GET /api/v1/projects/{project}/onboarding` or the user's request: read the
  draft and go on from its step.
- **Steps 2 and 3 are safe to repeat**: the CLI knows an upload of the same
  file by its title, and a `code:` portion replaces its earlier one whole.
- **Step 7 skips what is written**, by the numbers of the draft. Without the
  draft (another machine) start from step 0, take the arguments of `history`
  from the server (`history` of the answer of
  `GET /api/v1/projects/{project}/onboarding`), and before writing match what
  is already there: the entries of the chronicle by `created_at` and the range
  `first..last` in their text (progress entries carry no labels, and the title
  depends on the language); the decisions by the label `project-onboarding`;
  the overview by its title.
- **A rewritten history** — `--to` is no longer a commit: before step 7, run
  step 4 again with the new arguments on the server; after step 7 nothing
  written is changed, and the summary names the stages with the old hashes.

## Decline, stop and rollback

- **The user declines the offer** —
  `project_onboarding(project, state='declined')`, or
  `npx -y conport@^0.15.0 api arch onboarding-put --project <project> --state declined`.
  The offer is not shown again; an explicit start is still allowed.
- **The user stops in the middle** without a rollback — the state `declined`
  the same way; what is written stays.
- **The rollback** runs only on the user's word and only before `completed`,
  never as a step of your own; no refusal prescribes it. Delete what was
  written by the numbers of the draft, run
  `npx -y conport@^0.15.0 arch withdraw --all --apply` (without `--apply` it
  only shows what it would remove), and set the state `declined`. After
  `completed`, what is not wanted is deleted by the ordinary means, as in any
  project.

## Cost

Before step 4 tell the user the number of stages and of commit messages, and
warn that the model of your agent reads the commit messages; they never reach
ConPort. For a long history propose a later `--since`. When the history is
truncated by the limits of the CLI (`history_truncated: true`), the newest
commits stay and the stages are no longer the same on every machine. A later
`--since` does not lift the truncation: the whole line is read up to the
limits whatever the date. Raise the limits with
`CONPORT_GIT_PASS_LIMITS=<commits>:<milliseconds>` (100000:60000 by default)
and run the table of contents again; a truncated table is never cached.

## Without a person

A subagent and a scheduled run (`init` with `questions=false`) get the key
`onboarding`, not the lines of `init`, and the agent never starts the
procedure there: it needs the interviews.

## Several repositories

One repository is one project of ConPort. Interview 1 asks for the other
repositories of the product; the submodules of the repository are other
repositories too.

- **Already connected in the same team** — `link_project(project, target_project, link_type)`
  with the fitting type (`part_of`, `calls`, `shares_data`, `depends_on`), or
  `POST /api/v1/projects/{project}/project-links` with `target_project` and
  `link_type` through `npx -y conport@^0.15.0 api` (its `--help` lists the
  resource and the operation of that route), and section 5 of the overview
  links to its project.
- **Not connected yet** — the summary gives one action:
  `connect <repository> the same way and link the projects`. On the plan
  `free` a second project needs another plan, and the summary says so.
- **A project that already holds several repositories** (another repository
  names the same project in its `.conport.json`) is not split by the
  onboarding: the skeleton and the history are taken from the repository of
  the session. The summary names each other repository with the action
  `create a project of its own for the repository <name>, set it in .conport.json of that repository, connect it and link the projects`.
  A decision of the project itself that keeps the code out of the model goes
  to the user in interview 1: valid — step 3 is skipped and the draft says so;
  not valid — it is deprecated by step 1a.

## Refusals

The server answers a refused change of the state with a code and one action
(`error` and `action`; REST answers 422 with the same `detail`):

| Code | When | Do exactly this |
|---|---|---|
| `onboarding_in_progress_elsewhere` | Another member leads the running onboarding, and the call is not `take_over=true` | Another member of this team is onboarding this project: wait for them, or pass take_over=true if they abandoned it |
| `onboarding_not_ready` | `completed` while something blocks it; `blockers` names each | Clear each item of `blockers` by its action, then repeat the call. |
| `onboarding_transition_refused` from `not_started` | A state the onboarding cannot move to from `not_started` | From not_started the onboarding moves to in_progress or declined: call project_onboarding with one of them. |
| `onboarding_transition_refused` from `declined` | Anything but `in_progress` from `declined` | From declined the onboarding moves to in_progress only: call project_onboarding(project, state='in_progress') on the user's word. |
| `onboarding_transition_refused` from `completed` | Any change after `completed` | the project is onboarded: work on it as on any other |

`take_over=true` makes you the lead; pass it only on the user's word.

The blockers of `onboarding_not_ready`:

| Kind | When | Do exactly this |
|---|---|---|
| `backfill_not_completed` | The backfill of the model is not `completed` | Complete the model backfill: step 8 of the onboarding procedure, then arch_backfill(project, state='completed'). |
| `product_context_empty` | The product context has no version, or its latest is an empty object | Write the product context: PATCH /api/v1/projects/{project}/context/product with {"patch": {…}}. |

The other refusals the procedure meets:

| Code or line | Where | Do exactly this |
|---|---|---|
| `project_limit_reached` | `create_project` on a plan with no free project | change the plan or free a project |
| `name the document type: spec, architecture, runbook, api_docs, tutorial, meeting_notes, plan or other` | A document created or uploaded without its type (REST 422, an error of `add_document`) | Pass the type: `doc_type`, or `--doc-type` of `documents upload`. |
| `doc-<N> already has the title "<title>" with another body: …` | `documents upload` of a title the project holds with another body | The same file changed since its upload: renew doc-N in place, as step 2 says. Another file: give it a title of its own and upload it. |
| `not a git repository: connect without history — the first fill of the conport skill` | `history` outside git | Run the first fill, `references/bootstrap.md` without its own condition. |
| `no commits: connect without history — the first fill of the conport skill` | `history` in a repository without commits | Run the first fill, `references/bootstrap.md` without its own condition. |
| `shallow clone: run git fetch --unshallow and run conport history again` | `history` in a shallow clone | Run `git fetch --unshallow`, then step 4 again. |
| `--since takes a date YYYY-MM-DD` | `--since` that is not a date of the calendar | Pass the date as `YYYY-MM-DD`. |
| `--stage takes a stage number: 1, 2, …` | `--stage` that is not a number | Pass the number of a stage of the table. |
| `--ignore takes at most 50 paths of 1 to 512 characters: drop or merge the paths and run conport history again` | More than 50 `--ignore` paths, an empty one or one over 512 characters | Drop or merge the paths, then step 4 again. |
| `no commits after <date>: pass an earlier --since` | `--since` later than the last commit | Pass an earlier `--since`. |
| `no commit <sha>: the history was rewritten — run conport history without --to and start the history pass over` | `--to` is no longer a commit | *Draft and resume*, a rewritten history. |
| `too many stages (<K>): pass a later --since` | More stages than one onboarding takes | Ask the user for a later `--since`. |
| `no stage <N>: the history has <K> stages` | `--stage` outside the table | Run the stages of the table only. |
