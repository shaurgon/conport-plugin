// The notice the SessionStart hook gives the agent when the Superpowers
// overlay is on, written out word for word: the hook names the rules file and
// the source of the switch instead of carrying the rules, so the start context
// fits the 2 KB Claude Code shows the agent.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// support → test → scripts → conport-plugin.
const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const RULES = join(PLUGIN, 'skills', 'conport', 'references', 'superpowers-overlay.md')

// What Claude Code shows the agent of a hook's context; the rest goes to a file.
export const SHOWN_BYTES = 2048
// The budget of the whole start context with the overlay on, kept well under it.
export const START_CONTEXT_BUDGET = 1800

const SOURCES = {
  settings: '`plugins.superpowers` is `true` in .conport.json or .conport.local.json',
  old: '`conport.superpowers` is `true` in .superpowers/config.json, an old place of the switch',
}

// The notice for a switch in the settings files (`settings`) or in the old place (`old`).
export function overlayNotice(from, rules = RULES) {
  return [
    `ConPort Superpowers overlay: on (${SOURCES[from]}).`,
    "The user's preference for this project: specs and plans live in ConPort, not in git. " +
      'Never create or commit a file under docs/superpowers/specs/ or docs/superpowers/plans/; ' +
      'wherever a Superpowers skill says to write or commit one, follow the overlay rules instead.',
    'At the start of the session print one line: `[CONPORT] Superpowers overlay: on`.',
    `The overlay rules are not in this context: read the whole file \`${rules}\` ` +
      'before brainstorming, writing a spec or a plan, executing a plan or dispatching a subagent.',
  ].join('\n')
}
