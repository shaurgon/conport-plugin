// The conport skill teaches where the project and the settings come from: an
// agent with hooks takes the project from the `ConPort project:` line of the
// session start, an agent without hooks reads `.conport.json` and
// `.conport.local.json` by the whole rule, old places of the settings send the
// agent to the move document, and the overlay switch is `plugins.superpowers`.
// These tests read the skill, its references and its changelog as they ship.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionWith } from './support/changelog.mjs'

const SKILL_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'skills', 'conport')
const MOVE_DOC = 'https://conport.app/docs/projects/project-settings.md'

function read(name) {
  return readFileSync(join(SKILL_DIR, name), 'utf8')
}

// A text as one line, so a sentence is found however it is wrapped.
function flat(body) {
  return body.replace(/\s+/g, ' ')
}

// The text from the first line equal to `start` up to the next line that opens
// with `end` (or the end of the text).
function between(body, start, end) {
  const from = body.indexOf(`\n${start}\n`)
  assert.ok(from >= 0, `no line ${start}`)
  const to = end === null ? -1 : body.indexOf(`\n${end}`, from + start.length + 2)
  return body.slice(from, to < 0 ? undefined : to)
}

const SKILL = read('SKILL.md')
const STEP_1 = between(SKILL, '### Step 1: Determine the project name', '### Step 2')
const WITH_HOOKS = /\*\*Claude Code CLI\*\*[\s\S]*?(?=\n\*\*Cursor, Codex)/.exec(STEP_1)?.[0] ?? ''
const WITHOUT_HOOKS = /\n\*\*Cursor, Codex[\s\S]*?(?=\n\*\*Claude\.ai Chat\*\*)/.exec(STEP_1)?.[0] ?? ''

test('step 1 takes the project from the ConPort project line', () => {
  assert.ok(WITH_HOOKS, 'step 1 has no part for Claude Code')
  const text = flat(WITH_HOOKS)
  assert.match(text, /`ConPort project: <X> \(from <\.conport\.json \| \.conport\.local\.json \| CONPORT_PROJECT_NAME>\)`/)
  assert.match(text, /name and its source/i)
  // No line means no project: never a guess, never `init` with a name of one's own.
  assert.match(text, /Do not call `init`/)
  // A missing project is answered with the shared file to write, not with a variable.
  assert.match(STEP_1, /"\$schema": "https:\/\/conport\.app\/schema\/conport\.json",\s*\n\s*"project_name": "<project>"/)
})

test('step 1 gives agents without hooks the whole file rule', () => {
  assert.ok(WITHOUT_HOOKS, 'step 1 has no part for agents without hooks')
  const text = flat(WITHOUT_HOOKS)
  for (const needle of [
    '`LC_ALL=C git rev-parse --show-toplevel`',
    '`LC_ALL=C git rev-parse --git-common-dir`',
    'not a git repository',
    '`.conport.json`',
    '`.conport.local.json`',
    '`project_name`',
    '`CONPORT_PROJECT_NAME`',
    '`~/.config/conport/.env`',
    '`api_key`',
    '`apiKey`',
    '`CONPORT_API_KEY`',
    '`cport_`',
    '`plugins.superpowers`',
    '`plugins.codegraph`',
    '`arch`',
    '`units`',
  ]) {
    assert.ok(text.includes(needle), `the rule for agents without hooks does not name ${needle}`)
  }
  // "Outside git" is told by git's English text, so git is asked in English (LC_ALL=C), as the
  // hooks, the CLI and the Orca plugin ask it: under another locale a folder outside git would
  // read as a failure of git, and the agent would stop with no project. No git call of the
  // rule goes without it.
  assert.match(text, /`LC_ALL=C`[^.]*any locale/)
  assert.doesNotMatch(text, /`git rev-parse/)
  // The personal file is looked up in the main worktree when the current one has none.
  assert.match(text, /\.conport\.local\.json`[^.]*main worktree/)
  // The order: the personal file over the shared one, the variable only without a name in the files.
  assert.match(text, /`\.conport\.local\.json` over `\.conport\.json`/)
  assert.match(text, /`CONPORT_PROJECT_NAME`[^.]*only when neither file/)
  // A broken file is no reason to take the variable.
  assert.match(text, /not valid JSON[^.]*the variable is not read either/)
  // A file without `project_name` leaves the variable its turn; a wrong one does not.
  assert.match(text, /`project_name` is set but is not a non-empty string \(or carries an API key\)/)
  // An API key in a file is never read and never printed.
  assert.match(text, /holds an API key: revoke it at https:\/\/me\.conport\.app\/dashboard\/connect, create a new one and keep it in ~\/\.config\/conport\/\.env/)
  assert.match(text, /never print/i)
})

test('the skill sends old places to the move document', () => {
  const text = flat(STEP_1)
  // Agents with hooks act on the two lines of the session start.
  assert.ok(text.includes(`\`ConPort settings are in the old places (<list>): move them to .conport.json — ${MOVE_DOC}\``))
  assert.ok(text.includes(`\`Old ConPort settings left (<list>): remove them — ${MOVE_DOC}\``))
  // Agents without hooks look at the same places themselves.
  const own = flat(WITHOUT_HOOKS)
  for (const place of ['`.claude/settings.local.json`', '`.claude/settings.json`', '`.superpowers/config.json`']) {
    assert.ok(own.includes(place), `the rule for agents without hooks does not check ${place}`)
  }
  // `units` stays a valid key, but no ConPort component reads it: its old file is no old place.
  assert.ok(!text.includes('.conport/units.json'), 'step 1 names .conport/units.json as an old place')
  assert.ok(own.includes(MOVE_DOC), 'the rule for agents without hooks does not name the move document')
  // The document is carried out before the user's task, both ways.
  assert.match(text, /carry out the document [^.]*before the user's task/)
})

// The session start names each tool of the project that is not connected
// (the lines themselves are quoted by tool-setup.test.mjs); the skill tells an
// agent with hooks what to do with each line and an agent without hooks to
// make the same check itself. A key set to `false` silences it.
test('step 1 presses for Superpowers and codegraph, with hooks and without', () => {
  const hooks = flat(WITH_HOOKS)
  assert.match(hooks, /Never pass it over in silence/)
  assert.match(hooks, /When the user declines, set the key to `false`/)
  assert.match(hooks, /the line is not said again/)

  const own = flat(WITHOUT_HOOKS)
  const tools = own.slice(own.indexOf('**The tools.**'))
  assert.ok(own.includes('**The tools.**'), 'the rule for agents without hooks has no step for the tools')
  for (const needle of [
    '`plugins.superpowers`',
    '`plugins.codegraph`',
    '`codegraph --version`',
    '`.codegraph/`',
    '`npm install -g @colbymchenry/codegraph`',
    '`codegraph init`',
    'never pass it over in silence',
  ]) {
    assert.ok(tools.includes(needle), `the step for the tools does not name ${needle}`)
  }
  assert.match(tools, /A key set to `false` is the user's refusal: say nothing/)
  assert.match(tools, /When the user declines, set the key to `false` in `\.conport\.json` .*? and do not ask again\./)

  // The overlay no longer keeps silent about a missing switch.
  const overlay = flat(between(SKILL, '**Superpowers overlay.** In a project that works with the Superpowers skills', '- **SDD'))
  assert.doesNotMatch(overlay, /a missing key or a file that cannot be read means off — say nothing about it/)
  assert.match(overlay, /a missing key is never passed over in silence/)
})

test('the skill names no settings.local.json line for the project', () => {
  assert.doesNotMatch(SKILL, /"env":\s*\{\s*"CONPORT_PROJECT_NAME"/)
  // Every place that asks the user to set the project names `project_name` in `.conport.json`.
  for (const retired of [
    /into `CONPORT_PROJECT_NAME`/,
    /correct `CONPORT_PROJECT_NAME`/,
    /in `CONPORT_PROJECT_NAME`\./,
    /a `CONPORT_PROJECT_NAME` holding the handle/,
    /`CONPORT_PROJECT_NAME` not set/,
    /the `settings\.local\.json` line/,
    /name: "<CONPORT_PROJECT_NAME>"/,
  ]) {
    assert.doesNotMatch(SKILL, retired)
  }
  const refusals = flat(between(SKILL, '### Refusals — one action each', '`create_project(name'))
  for (const refusal of ['project_name_in_other_team', 'invalid_project_name', 'invalid_team_id']) {
    const row = refusals.split('| `').find((cell) => cell.startsWith(`${refusal}\``))
    assert.ok(row, `no refusal row ${refusal}`)
    assert.ok(row.includes('`project_name` of `.conport.json`'), `the row ${refusal} does not name project_name of .conport.json`)
  }
  assert.match(flat(SKILL), /put the new name into `project_name` of `\.conport\.json`/)
  assert.match(flat(SKILL), /a `project_name` holding the handle needs no change/)
  assert.match(SKILL, /^- \[ \] No project.*`\.conport\.json`/m)
  const commandList = flat(read('references/command_list.md'))
  assert.match(commandList, /set its `canonical_name` as `project_name` of `\.conport\.json`/)
  assert.doesNotMatch(commandList, /`canonical_name` as `CONPORT_PROJECT_NAME`/)
})

test('the overlay switch is plugins.superpowers', () => {
  const overlay = flat(between(SKILL, '**Superpowers overlay.** In a project that works with the Superpowers skills', '- **SDD'))
  assert.match(overlay, /\*\*The switch\*\* is `plugins\.superpowers`/)
  assert.match(overlay, /`\.conport\.local\.json`/)
  // The old switch is read only while `.conport.json` does not set the key.
  assert.match(overlay, /only while neither file sets `plugins\.superpowers`/)
  assert.doesNotMatch(overlay, /write that file at the root of the main worktree/)
  const rules = read('references/superpowers-overlay.md')
  const head = flat(rules.split('\n\n').slice(0, 2).join(' '))
  assert.match(head, /`plugins\.superpowers` is `true` in `\.conport\.json`/)
  assert.doesNotMatch(head, /\{"conport": \{"superpowers": true\}\}/)
  const fails = flat(rules.slice(rules.indexOf('## When the CLI fails')))
  assert.match(fails, /pass `--project <handle>`/)
  assert.match(fails, /set `plugins\.superpowers` to `false` in `\.conport\.local\.json`/)
  assert.doesNotMatch(fails, /set `CONPORT_PROJECT_NAME`/)
  assert.doesNotMatch(fails, /remove the `conport\.superpowers` key/)
})

test('every recipe of the skill runs a CLI that reads .conport.json', () => {
  // No CLI before 0.11.0 reads `.conport.json`: a range below it runs on the
  // variable alone, so after the move a recipe loses its project or writes into
  // the project a stale variable names. The onboarding procedure runs `history`,
  // which comes with 0.15.0; the other texts keep the range they ship with.
  const files = {
    'SKILL.md': '^0.14.0',
    'references/superpowers-overlay.md': '^0.14.0',
    'references/command_list.md': '^0.14.0',
    'references/model-backfill.md': '^0.14.0',
    'references/project-onboarding.md': '^0.15.0',
  }
  for (const [name, range] of Object.entries(files)) {
    const body = read(name)
    const below = []
    for (const found of body.matchAll(/conport@[~^]?(\d+)\.(\d+)(?:\.(\d+))?/g)) {
      const [, major, minor, patch] = found
      const version = [Number(major), Number(minor), Number(patch ?? -1)]
      if (patch === undefined || version[0] * 1e6 + version[1] * 1e3 + version[2] < 11 * 1e3) below.push(found[0])
    }
    assert.deepEqual(below, [], `${name} runs a CLI that does not read .conport.json`)
    assert.ok(body.includes(`npx -y conport@${range} `), `${name} runs no npx -y conport@${range}`)
  }
  const fails = flat(read('references/superpowers-overlay.md').split('## When the CLI fails')[1])
  assert.match(fails, /a `npx -y conport@\^0\.14\.0 …` command fails/)
})

// The entry is the section that links the move document, under whatever heading the release gave it.
test('the changelog names the settings move in the release that ships it', () => {
  const entry = flat(sectionWith(read('CHANGELOG.md'), MOVE_DOC))
  for (const needle of [
    '`.conport.json`',
    '`.conport.local.json`',
    '`ConPort project:',
    '`CONPORT_PROJECT_NAME`',
    '`~/.config/conport/.env`',
    '`plugins.superpowers`',
    '`.superpowers/config.json`',
    '`units`',
    MOVE_DOC,
    'session',
  ]) {
    assert.ok(entry.includes(needle), `the settings entry of the changelog does not name ${needle}`)
  }
  assert.doesNotMatch(entry, /\b(task|decision|doc|progress)-\d+\b/)
})
