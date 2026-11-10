# ConPort Superpowers overlay

This project has the ConPort Superpowers overlay switched on
(`.superpowers/config.json` holds `{"conport": {"superpowers": true}}`).

**The user's preference for this project:** specs and plans live in ConPort,
not in git. A spec is a ConPort document of type `spec`, a plan is a ConPort
document of type `plan`, the epic's tasks are tied to the plan's sections, and
local files are only drafts and caches. Specs and plans are never committed.
Superpowers puts the human partner's preferences above its own skills: wherever
a Superpowers skill says to write a spec or plan under `docs/superpowers/` or
to commit it, follow the steps below instead. Nowhere in this flow is a file
created in `docs/superpowers/specs/` or `docs/superpowers/plans/`; where the
plugin's hooks run, the commit guard refuses to commit a new one.

**Visibility.** At the start of the session print one line:

```
[CONPORT] Superpowers overlay: on
```

**Paths** below are relative to the worktree root. Whenever you create a
directory inside `.superpowers/`, put a `.gitignore` containing the single
line `*` into it if it has none (the CLI does the same for the directories it
creates).

## The flow

1. **Brainstorming.** Write the spec draft to
   `.superpowers/drafts/<date>-<topic>-design.md`.
2. **Spec review and gap hunt on the draft.** Both work on the draft file —
   nothing is uploaded yet. Give the spec reviewer and the gap hunter
   (`conport:sdd-gap-hunter`) the path
   `.superpowers/drafts/<date>-<topic>-design.md` as their scope and the goal
   as the user stated it — never a goal taken from the draft they check — and
   put their findings into the draft.
3. **Approval.** The user reads and approves the draft with the findings in it.
4. **Upload the spec, once.**
   `npx -y conport@^0.7 documents upload <draft> --doc-type spec` → `doc-N`.
   Delete the draft. Until the plan, the spec is not edited; if it must be,
   edit it with ConPort's block tools (`update_block`, `insert_block`, an
   `amend` change). For a local copy run
   `npx -y conport@^0.7 documents get doc-N` → `.superpowers/docs/doc-N.md`.
5. **Plan.** Write the plan draft to `.superpowers/drafts/<date>-<topic>.md` in
   the writing-plans format (`### Task N: <title>`). After the user approves it:
   `npx -y conport@^0.7 plan import <draft> --spec doc-N [--epic <id>] [--milestone <id>]`
   — this creates the `plan` document, the epic and its tasks. Attach the epic
   to a milestone by the project's roadmap rules. Delete the draft and the
   `<draft>.conport.json` that `plan import` wrote beside it.

   Every `### Task N:` section carries two lines: `**Goal:** <one sentence>`
   and `**Acceptance:** <criterion>`; the criterion may continue as a list
   directly below that line. `plan import` builds a new task's description
   from these two lines and refuses, before writing anything, a section that
   would create a task without them. The terminal finish section needs neither.
6. **Execution.** `npx -y conport@^0.7 plan pull <epic>` →
   `.superpowers/plans/doc-M.md`. Superpowers SDD works with this file (its
   `task-brief`, `review-package` and `sdd-workspace` scripts take the plan
   file path). If `/conport:task` or `/conport:epic` is used, pass it the same
   pulled path as the `plan` key of its JSON argument:
   `/conport:task {"task": <id>, "plan": ".superpowers/plans/doc-M.md"}`,
   `/conport:epic {"epic": <id>, "plan": ".superpowers/plans/doc-M.md"}`. Briefs, reports,
   reviews and fixes are entries in the task's journal; stages are the
   `REVIEW` status. Keep the `<file>.conport.json` written next to the pulled
   plan: import and finish read it.

   **Dispatching a subagent.** A brief, a report, a review and a fix live in
   the task's journal, never in files: nothing is written under
   `.superpowers/sdd/`, and a dispatch names no file there. Wherever SDD says to
   write a brief file, a report file or a review package, do this instead:
   - **Brief.** Put the task's full text (`task-brief` prints it) and the
     context the subagent needs into one entry:
     `add_task_journal_entry(project=<project>, task_id=<N>, kind="brief", body=<the brief>)`.
   - **Dispatch.** The prompt is the task number and how to read its journal,
     and nothing else from the brief:

     ```
     Your task is task-<N> in the ConPort project <project>; the brief is in its journal.
     Read it: get_task_journal_entry(project=<project>, task_id=<N>, kind="brief").
     Earlier reports, reviews and fixes: list_task_journal(project=<project>, task_id=<N>, include_body=true)
     (when the answer has next_offset, call again with offset=next_offset).
     ```

     A reviewer gets, in addition, the two commits to diff: `BASE` and `HEAD`.
   - **The agent type.** In Claude Code dispatch the plugin's agents:
     `conport:sdd-implementer` for the implementation,
     `conport:sdd-task-reviewer` for a review, `conport:sdd-fixer` for a fix
     round, `conport:sdd-gap-hunter` for a gap hunt and
     `conport:sdd-final-reviewer` for the final review of the whole branch.
     The first three read the brief from the journal when the prompt points
     there and write their answer as the entry below; the last two hand their
     findings back in their answer.
   - **The subagent's answer** is an entry, written in full in `body`: the
     implementer's report `kind="report"`, the reviewer's verdict
     `kind="review"` with `verdict="approve"` or `verdict="changes_requested"`,
     the fixer's report `kind="fix"`. The entry moves the task: a report or a
     fix puts it in REVIEW (a report starts a TODO task first), a review that
     requests changes returns it to IN_PROGRESS for the next round. Without
     `author` the entry is signed by its role — `implementer` for a report or a
     fix, `reviewer` for a review — so a review never signs as the report's
     author. The subagent's final message is only the status and the entry's
     id.
   - **A closed task** refuses every entry with `journal_task_closed`: reopen
     the task, then write the entry.
7. **Editing the plan during the work.** `npx -y conport@^0.7 plan pull <epic>`
   → edit the pulled file above the line `<!-- conport-pull-tail -->` →
   `npx -y conport@^0.7 plan import <pulled file>` →
   `npx -y conport@^0.7 plan pull <epic>` again (it rewrites the tail with the terminal task under its new
   number) → continue SDD. Once execution has started, section numbers never
   change: a new section takes the next free number, and a section no longer
   needed is not removed from the plan — its task is set to `CANCELLED` in
   ConPort with a resolution. The SDD ledger and `task-brief` key on the
   section number. When `plan import` refuses because `<file>` and ConPort's
   plan have both changed since pull: move `<file>` aside to
   `<file>.mine.md`, run `npx -y conport@^0.7 plan pull <epic> -o <file>`,
   carry your edits over from `<file>.mine.md`, run `plan import` again.
8. **Finish.** The final whole-branch review (`conport:sdd-final-reviewer`
   in Claude Code) is clean and its fixes are merged → the terminal task of
   the pulled plan → `superpowers-conport` in `finish` mode on the pulled plan
   file → on a `READY` verdict the epic is closed, then the release follows
   the conport skill's section "Epic in its own branch".

## When the CLI fails

The CLI reads its API key from `CONPORT_API_KEY` in the environment or in
`~/.config/conport/.env`, never from the plugin's settings. When a
`npx -y conport@^0.7 …` command fails with `CONPORT_API_KEY is not set`, the
one action is: set `CONPORT_API_KEY` (env or `~/.config/conport/.env`) and
retry. When it fails with `No project specified`, or with
`CONPORT_PROJECT_ID is no longer read — set CONPORT_PROJECT_NAME to the project's handle or name`,
the one action is: set `CONPORT_PROJECT_NAME` to the project's handle or name
and retry. When it says `<file>.conport.json names the project by a retired number`,
run the `plan pull` command that line gives. None of these is a reason to turn
the overlay off.

If the CLI does not run at all (no Node.js, no network, an old version), tell
the user in one line which command failed and why, and ask whether to turn the
overlay off for this work. With the user's consent,
remove the `conport.superpowers` key from `.superpowers/config.json`: the
plugin then behaves as before — the `superpowers-conport` bridge with its
anchors, spec and plan files in git. Until the user agrees, keep the drafts in
`.superpowers/drafts/` and do not commit them under `docs/superpowers/`.
