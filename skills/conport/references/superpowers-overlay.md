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
   `.superpowers/drafts/<date>-<topic>-design.md`. The user reads it and
   approves it.
2. **Upload the spec.**
   `npx -y conport@^0.4 documents upload <draft> --doc-type spec` → `doc-N`.
   Delete the draft. From now on edit the spec with ConPort's block tools
   (`update_block`, `insert_block`, an `amend` change). For a local copy run
   `npx -y conport@^0.4 documents get doc-N` → `.superpowers/docs/doc-N.md`.
3. **Gap hunt after the spec** works on the ConPort document; its findings go
   into that document.
4. **Plan.** Write the plan draft to `.superpowers/drafts/<date>-<topic>.md` in
   the writing-plans format (`### Task N: <title>`). After the user approves it:
   `npx -y conport@^0.4 plan import <draft> --spec doc-N [--epic <id>] [--milestone <id>]`
   — this creates the `plan` document, the epic and its tasks. Attach the epic
   to a milestone by the project's roadmap rules. Delete the draft and the
   `<draft>.conport.json` that `plan import` wrote beside it.
5. **Execution.** `npx -y conport@^0.4 plan pull <epic>` →
   `.superpowers/plans/doc-M.md`. Superpowers SDD works with this file (its
   `task-brief`, `review-package` and `sdd-workspace` scripts take the plan
   file path). If `/conport:task` or `/conport:epic` is used, pass it the same
   pulled path as the `plan` key of its JSON argument:
   `/conport:task {"task": <id>, "plan": ".superpowers/plans/doc-M.md"}`,
   `/conport:epic {"epic": <id>, "plan": ".superpowers/plans/doc-M.md"}`. Briefs, reports,
   reviews and fixes are entries in the task's journal; stages are the
   `REVIEW` status. Keep the `<file>.conport.json` written next to the pulled
   plan: import and finish read it.
6. **Editing the plan during the work.** `npx -y conport@^0.4 plan pull <epic>`
   → edit the pulled file above the line `<!-- conport-pull-tail -->` →
   `npx -y conport@^0.4 plan import <pulled file>` →
   `npx -y conport@^0.4 plan pull <epic>` again (it rewrites the tail with the terminal task under its new
   number) → continue SDD. Once execution has started, section numbers never
   change: a new section takes the next free number, and a section no longer
   needed is not removed from the plan — its task is set to `CANCELLED` in
   ConPort with a resolution. The SDD ledger and `task-brief` key on the
   section number. When `plan import` refuses because `<file>` and ConPort's
   plan have both changed since pull: move `<file>` aside to
   `<file>.mine.md`, run `npx -y conport@^0.4 plan pull <epic> -o <file>`,
   carry your edits over from `<file>.mine.md`, run `plan import` again.
7. **Finish.** The final whole-branch review is clean and its fixes are
   merged → the terminal task of the pulled plan → `superpowers-conport` in
   `finish` mode on the pulled plan file → on a `READY` verdict the epic is
   closed, then the release follows the conport skill's section
   "Epic in its own branch".

## When the CLI fails

The CLI reads its API key from `CONPORT_API_KEY` in the environment or in
`~/.config/conport/.env`, never from the plugin's settings. When a
`npx -y conport@^0.4 …` command fails with `CONPORT_API_KEY is not set`, the
one action is: set `CONPORT_API_KEY` (env or `~/.config/conport/.env`) and
retry. When it fails with `No project specified`, the one action is: set
`CONPORT_PROJECT_NAME` and retry. Neither is a reason to turn the overlay off.

If the CLI does not run at all (no Node.js, no network, an old version), tell
the user in one line which command failed and why, and ask whether to turn the
overlay off for this work. With the user's consent,
remove the `conport.superpowers` key from `.superpowers/config.json`: the
plugin then behaves as before — the `superpowers-conport` bridge with its
anchors, spec and plan files in git. Until the user agrees, keep the drafts in
`.superpowers/drafts/` and do not commit them under `docs/superpowers/`.
