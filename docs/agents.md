# Agents

## The agents

The plugin ships its own agent types under `agents/`, and Claude Code lists
them under the plugin's name. They serve subagent-driven development: the
session that leads an epic dispatches them. The model reviewer is no step of
an epic: the session that submits a portion of the project model starts it.

| Agent type | Dispatched for | Can edit files |
|---|---|---|
| `conport:sdd-implementer` | every implementation | yes |
| `conport:sdd-task-reviewer` | every review, re-review and review after a rebase, and the review of the fix round of the Final review task | no |
| `conport:sdd-fixer` | the fix round after a review | yes |
| `conport:sdd-gap-hunter` | the gap hunt of an epic | no |
| `conport:sdd-final-reviewer` | the final review of a whole epic branch against its spec, started by the session that leads the epic | no |
| `conport:model-reviewer` | the review of a document's draft portion of the project model against the document's text, before it is submitted; started by the session that submits the portion | no |

Each carries the standing procedure of its role — for the SDD roles: read the
brief first, test first, the checks before the commit, never `git stash`; for
all of them: no subagents of its own (the Agent tool is denied to all six) —
while the dispatch supplies the task and decides where it is more specific:
which checks to run, the branch to create, the structured answer to return.
None of them pins a model: they run on the model of your session.

Dispatch them with a brief and a report path, or with a ConPort task whose
journal holds the brief. With the briefs in the task journal an agent of any
kind works the journal through the ConPort MCP tools or the `conport journal`
commands, decides an ambiguity by the spec and records the decision, and
raises a block with `conport task block` only for an irreversible operation or
a merge conflict it cannot resolve without guessing. The gap hunter and the
final reviewer hand their findings back in their answer to whoever started
them; the session that leads an epic starts the final reviewer once, after
every task has merged.

## A plan kept in ConPort

With the Superpowers overlay on (see the plugin README), a plan is not a file
under `docs/superpowers/plans/` but a ConPort document of type `plan`. Before
leading its epic by subagent-driven development, take it into a local file
with `plan pull` and work from that file:

```
npx -y conport@^0.17.0 plan pull <epic id>
```

The JSON answer of `plan pull` names the file it wrote (`file`, for example
`.superpowers/plans/doc-M.md`, where `doc-M` is the plan document) and a
`<file>.conport.json` is kept beside it. The pulled file carries a marker under
each section that ties it to its task. Pull again after the plan changes in
ConPort: a stale copy is the plan as it was.
