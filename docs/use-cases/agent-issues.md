# Tell the service developers about a problem

## When it happens

The agent writes an issue while it works, when the problem is in ConPort
rather than in the project:

- no scenario kind fits what the project needs to show;
- an entity type or a link type the work needs does not exist;
- a refusal does not say what to do, or its action did not help;
- a tool behaves differently from its description;
- a call fails again on a database or server error after the one retry the error asks for.

You can also ask for it:

> That refusal made no sense — tell the ConPort developers.

## What happens

The `conport` skill sends the problem as a GitHub issue in the public
repository [`shaurgon/conport-plugin`](https://github.com/shaurgon/conport-plugin/issues):
with `gh`, or through the issue form *Agent report* when you submit it. Every
title starts with `[agent-report] `: the title, not a label, marks an agent
report, because GitHub drops labels set by an author without triage access.

1. It writes the title and the body, shows them to you and posts nothing
   until you agree. A run with no person at it — a routine, a subagent, a
   scheduled run — never posts: the report goes into the run's summary, and
   the next session with you that finds it there takes it through these steps.
2. With `gh` available it searches the open agent reports for the same problem
   (`gh issue list -R shaurgon/conport-plugin --state open --search "[agent-report] <words> in:title"`),
   comments on a match instead of opening a second issue, and otherwise files
   `gh issue create -R shaurgon/conport-plugin --title "[agent-report] <tool>: <what went wrong>" --body "…"`;
   the kind is a field of the body. It tells you in one line, with the issue's
   URL. When `gh` refuses — not logged in, no network or a sandbox block,
   `403`, a rate limit — it does not retry and takes the path without `gh`.
3. Without `gh` it first gives you (or opens itself, when it can read the web)
   the search of the open agent reports:

   ```
   https://github.com/shaurgon/conport-plugin/issues?q=is%3Aissue+is%3Aopen+in%3Atitle+%22%5Bagent-report%5D%22+<url-encoded words>
   ```

   A match the agent found → it gives you its URL and the body to add there as
   a comment, and never claims the comment was posted. A match you found → you
   comment on it with the body instead of filing. No match → a
   link to the form with every field filled (each value URL-encoded):

   ```
   https://github.com/shaurgon/conport-plugin/issues/new?template=agent-report.yml&title=<title>&kind=<kind>&called=<call>&expected=<expectation>&returned=<answer>&refusal_code=<code>&client=<version-and-client>
   ```

   The report is not sent until you submit it, and the agent says so.

## If something private got in

GitHub keeps an edited text's earlier version in its edit history, visible
to every reader, and only its web page deletes a revision — an edit alone
removes nothing, and `gh` cannot remove it, so the agent cannot delete a
revision for you.

- A secret in an issue or a comment → the agent tells you to revoke and rotate
  it at once, then to take it out as below.
- Project content in a comment posted for the report → the agent tells you to
  delete the comment.
- Project content in an issue filed for the report → the agent tells you to
  edit it out and delete the earlier revision in the issue's edit history on
  its web page; you cannot → the agent asks for its deletion.
- Project content in someone else's issue → the agent asks for its removal; the
  repository's owner removes it.

To ask, the agent writes a comment that asks for it, never repeating the
content, shows it to you and posts it only after you agree — with `gh`:
`gh issue comment <issue URL> --body "…"`; without `gh`, or when `gh` refuses
(it does not retry), it gives you the issue's URL and the text to post, and
never claims it was posted.

## What the issue holds

The issue is public and is read by the ConPort service developers, not by
your team. It describes the service's behaviour only:

| Field | Required |
|---|---|
| Kind — `defect`, `missing`, `unclear-refusal` | yes |
| What was called — the tool or command and its parameters | yes |
| What was expected | yes |
| What came back — the answer, or the refusal code and its text | yes |
| Refusal code | no |
| Skill version and client (`claude-code`, `cursor`, …) | no |

Project content (texts of decisions, documents, code, task titles), client or
person names, and secrets never go into it: the agent replaces them with
placeholders such as `<handle>` or `<task id>`.

## Shape of an issue

```
Title: [agent-report] <tool>: <what went wrong, in one line>

### Kind
unclear-refusal
### What was called
<tool>(project=<handle>, task_id=<task id>, …)
### What was expected
<what the description of the tool promises>
### What came back
<refusal code>: <its text>
### Refusal code
<refusal code>
### Skill version and client
conport 20.4.0, claude-code
```
