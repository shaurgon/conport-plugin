// The tools a ConPort project works with — the Superpowers plugin and the
// codegraph index — and the lines the session start says while one of them is
// not connected. A tool is connected when its key in the project's settings
// (`plugins.superpowers`, `plugins.codegraph`) is `true` and the tool is there:
// Superpowers installed in Claude Code and not turned off there; codegraph on
// PATH with its index `.codegraph/` at the root of the working tree. A key set
// to `false` is the user's refusal: nothing is said. Each line names one
// action. `toolLines` is pure; `toolFacts` reads the machine. Built-in modules
// only.
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizePath } = require('./project-config.js');

const INSTALL_SUPERPOWERS = '`/plugin install superpowers@claude-plugins-official`';
const INSTALL_CODEGRAPH = '`npm install -g @colbymchenry/codegraph`';
const BUILD_INDEX = '`codegraph init` at its root';

// How a line opens, before its action: the skill quotes each of them, and a
// reader of the session start can tell the lines of the tools by them.
const TOOL_LINE_HEADS = [
  'Superpowers is not installed',
  'Superpowers is turned off in Claude Code',
  '`plugins.superpowers` is not set while Superpowers is installed',
  'codegraph is not installed',
  'No codegraph index in this working tree',
  '`plugins.codegraph` is not set while the codegraph index is built',
];

// The `true` a line names, by where it came from.
const KEY_TRUE = {
  settings: (key) => `\`plugins.${key}\` is \`true\``,
  old: () => '`conport.superpowers` is `true` in .superpowers/config.json',
};

// The clause that tells the agent where a refusal goes: a refusal of one
// person (or of one throwaway working tree) belongs in the personal file.
const declined = (key) => `; if the user declines, set \`plugins.${key}\` to \`false\` — ` +
  'in .conport.local.json for themselves, in .conport.json for the team';

// One step of connecting a tool: its line with the key absent, and with the
// key `true` (`keyTrue` names it), which offers no refusal.
function step(head, action, key) {
  return {
    line: `${head}: ${action}${declined(key)}`,
    lineOn: (keyTrue) => `${head}, while ${keyTrue}: ${action}`,
  };
}

// A plugin id that can go into a command as it is: `name@marketplace`.
const PLAIN_ID = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/;
// The action that turns Superpowers on at `scope`. The project's settings are
// shared by the team, so that scope says so and offers the personal one.
function enableAction(id, scope) {
  const note = scope === 'project'
    ? ', which changes the shared .claude/settings.json of the project — tell the user so, ' +
      'and offer `--scope local` to turn it on for them alone'
    : '';
  return `turn it on — \`claude plugin enable ${id} --scope ${scope}\`${note}`;
}

// The line about one tool, or null. `key` is the key's value (true, false or
// undefined when it is not set) and `keyTrue` the words for its `true`;
// `steps` the steps of connecting the tool in order, each {done, line,
// lineOn}: the first one not done names the action, and with all done an
// absent key is to be set (`setLine`).
function toolLine({ key, keyTrue }, steps, setLine) {
  if (key === false) return null;
  const missing = steps.find((s) => !s.done);
  if (missing) return key === true ? missing.lineOn(keyTrue) : missing.line;
  return key === true ? null : setLine;
}

// The lines the session start says about the tools, one per tool that is not
// connected. `superpowers` is {key, from}: the value of `plugins.superpowers`
// (`from` 'settings') or of the old flag `conport.superpowers` (`from` 'old'),
// key undefined when neither sets it; `codegraph` the value of
// `plugins.codegraph`. `facts` is what `toolFacts` read.
function toolLines({ superpowers, codegraph, facts }) {
  const sp = superpowers && typeof superpowers.key === 'boolean' ? superpowers : { key: undefined, from: null };
  const off = facts.superpowersOff;
  const enable = off ? enableAction(PLAIN_ID.test(off.id) ? off.id : 'superpowers', off.scope) : '';
  return [
    toolLine({ key: sp.key, keyTrue: KEY_TRUE[sp.from === 'old' ? 'old' : 'settings']('superpowers') }, [
      { done: facts.superpowersInstalled, ...step(TOOL_LINE_HEADS[0], `install it — ${INSTALL_SUPERPOWERS}`, 'superpowers') },
      { done: !off, ...step(TOOL_LINE_HEADS[1], enable, 'superpowers') },
    ], `${TOOL_LINE_HEADS[2]}: turn the ConPort overlay on as the conport skill says (Superpowers overlay)${declined('superpowers')}`),
    toolLine({ key: typeof codegraph === 'boolean' ? codegraph : undefined, keyTrue: KEY_TRUE.settings('codegraph') }, [
      { done: facts.codegraphInstalled, ...step(TOOL_LINE_HEADS[3], `install it — ${INSTALL_CODEGRAPH}`, 'codegraph') },
      { done: facts.codegraphIndexed, ...step(TOOL_LINE_HEADS[4], `build it — ${BUILD_INDEX}`, 'codegraph') },
    ], `${TOOL_LINE_HEADS[5]}: set it to \`true\` in .conport.json${declined('codegraph')}`),
  ].filter(Boolean);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The folder of Claude Code's own settings: CLAUDE_CONFIG_DIR, else ~/.claude.
function claudeConfigDir(env, home) {
  const dir = String((env && env.CLAUDE_CONFIG_DIR) || '').trim();
  return dir || path.join(home, '.claude');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

// The ids (`superpowers@<marketplace>`) under which Claude Code has the
// Superpowers plugin installed for `roots`, by its registry of installed
// plugins (`plugins/installed_plugins.json`): installed for the user, or for a
// project whose path is one of `roots`. A missing or unreadable registry has
// none.
function installedSuperpowers({ env, home, roots = [] }) {
  const registry = readJson(path.join(claudeConfigDir(env, home), 'plugins', 'installed_plugins.json'));
  const plugins = isObject(registry) ? registry.plugins : null;
  if (!isObject(plugins)) return [];
  const known = roots.filter(Boolean).map(normalizePath);
  const ids = [];
  for (const [id, value] of Object.entries(plugins)) {
    if (id.split('@')[0] !== 'superpowers') continue;
    const installs = Array.isArray(value) ? value : [value];
    const here = installs.some((install) => {
      if (!isObject(install)) return false;
      const where = typeof install.projectPath === 'string' && install.projectPath ? install.projectPath : null;
      return !where || known.includes(normalizePath(where));
    });
    if (here) ids.push(id);
  }
  return ids;
}

// Claude Code's `enabledPlugins` for the working tree at `root`, each plugin
// as {on, scope}: the user's settings.json (scope `user`), then the project's
// `.claude/settings.json` (`project`), then its `.claude/settings.local.json`
// (`local`), each later one over the earlier; `scope` names the settings the
// value that wins came from, as `claude plugin enable --scope` names them. A
// missing or unreadable file adds nothing.
function enabledPlugins({ env, home, root }) {
  const layers = [['user', path.join(claudeConfigDir(env, home), 'settings.json')]];
  if (root) {
    layers.push(['project', path.join(root, '.claude', 'settings.json')],
      ['local', path.join(root, '.claude', 'settings.local.json')]);
  }
  const enabled = {};
  for (const [scope, file] of layers) {
    const value = readJson(file);
    if (!isObject(value) || !isObject(value.enabledPlugins)) continue;
    for (const [id, on] of Object.entries(value.enabledPlugins)) enabled[id] = { on, scope };
  }
  return enabled;
}

// Whether Superpowers is installed for the working tree and, when every
// install of it is turned off (`false` in `enabledPlugins`), the id of the
// first one with the scope of the settings whose `false` wins: {installed,
// off: {id, scope} | null}. A `true` written at that scope replaces the very
// value that keeps the plugin off.
function superpowersState({ env, home, roots, root }) {
  const ids = installedSuperpowers({ env, home, roots });
  if (!ids.length) return { installed: false, off: null };
  const enabled = enabledPlugins({ env, home, root });
  const isOff = (id) => Boolean(enabled[id]) && enabled[id].on === false;
  return { installed: true, off: ids.every(isOff) ? { id: ids[0], scope: enabled[ids[0]].scope } : null };
}

// Whether `name` is a command on the PATH of `env`: an executable file in one
// of its folders (on Windows with one of the PATHEXT endings).
function onPath(name, env, platform = process.platform) {
  const dirs = String((env && env.PATH) || '').split(path.delimiter).filter(Boolean);
  const windows = platform === 'win32';
  const endings = windows
    ? String((env && env.PATHEXT) || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ending of endings) {
      try {
        const stat = fs.statSync(path.join(dir, name + ending));
        if (stat.isFile() && (windows || (stat.mode & 0o111))) return true;
      } catch (_) {
        // not here
      }
    }
  }
  return false;
}

// Whether `root` holds a codegraph index: the folder `.codegraph/`.
function codegraphIndexed(root) {
  if (!root) return false;
  try {
    return fs.statSync(path.join(root, '.codegraph')).isDirectory();
  } catch (_) {
    return false;
  }
}

// What the machine says about the tools of the working tree at `root`.
function toolFacts({ root, mainRoot, env, home }) {
  const superpowers = superpowersState({ env, home, roots: [root, mainRoot], root });
  return {
    superpowersInstalled: superpowers.installed,
    superpowersOff: superpowers.off,
    codegraphInstalled: onPath('codegraph', env),
    codegraphIndexed: codegraphIndexed(root),
  };
}

module.exports = {
  TOOL_LINE_HEADS, toolLines, toolFacts, installedSuperpowers, enabledPlugins, superpowersState, onPath,
  codegraphIndexed, claudeConfigDir,
};
