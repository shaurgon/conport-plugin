// The unit manifest of a repository and the comparison of two trees by it. An epic
// does not raise a unit version: the release step raises each changed unit once,
// after every epic of the release milestone has merged. Both workflows hold that
// before READY with the helper's `versions` command, which reads the manifest and the
// two trees out of git and asks this module what differs. Which units a project has
// and where each carries its version are the project's data, never this plugin's: they
// live in the project's own manifest, MANIFEST_PATH at its repository root. Pure: no
// git, no I/O — a tree is { read(path) -> text | null, list(dir) -> paths under dir }.

export const MANIFEST_PATH = '.conport/units.json'

// The ways a carrier's version is read, by the one key of its `read` object:
//   {"json": "<path>"}   a field of a JSON file — dot-separated, "name[]" maps over an
//                        array, whose values are joined: "plugins[].version";
//   {"regex": "<re>"}    the first group of a regular expression (multiline) over the text;
//   {"skill": "metadata.version"}  metadata.version of a SKILL.md frontmatter — a
//                        "version:" in prose or in the body is not it.
const jsonPath = path => text => {
  let values
  try { values = [JSON.parse(text)] } catch { return null }
  for (const seg of path.split('.')) {
    const many = seg.endsWith('[]')
    const key = many ? seg.slice(0, -2) : seg
    values = values.flatMap(v => {
      const got = v !== null && typeof v === 'object' ? v[key] : undefined
      return many ? (Array.isArray(got) ? got : [undefined]) : [got]
    })
  }
  return values.length && values.every(v => typeof v === 'string') ? values.join(', ') : null
}
const regexRead = re => text => {
  const m = re.exec(text)
  return m && typeof m[1] === 'string' ? m[1] : null
}
const skillVersion = text => {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const m = fm && /^metadata:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+version:[ \t]*["']?([^"'\s]+)/m.exec(fm[1] + '\n')
  return m ? m[1] : null
}

const isText = v => typeof v === 'string' && v.trim() !== ''
const readerOf = (read, where) => {
  const keys = read !== null && typeof read === 'object' && !Array.isArray(read) ? Object.keys(read) : []
  if (keys.length !== 1) return where + ': read must hold exactly one of json, regex, skill'
  const [kind] = keys
  const arg = read[kind]
  if (kind === 'json') return isText(arg) ? jsonPath(arg) : where + ': read.json must be a field path'
  if (kind === 'regex') {
    if (!isText(arg)) return where + ': read.regex must be a regular expression'
    let re
    try { re = new RegExp(arg, 'm') } catch (e) { return where + ': read.regex does not compile: ' + e.message }
    // an alternative that matches the empty string reports how many groups the expression has
    if (new RegExp('(?:' + arg + ')|').exec('').length < 2) return where + ': read.regex must capture the version in its first group'
    return regexRead(re)
  }
  if (kind === 'skill') return arg === 'metadata.version' ? skillVersion : where + ': read.skill must be "metadata.version"'
  return where + ': unknown read "' + kind + '" — use json, regex or skill'
}

// The manifest's text -> { units: [{unit, carriers: [{path | dir+file, read(text)}]}] }
// or { error } naming the first thing that is wrong. A carrier is one file (`path`) or
// every file of one name under a directory (`dir` + `file`).
export const parseUnitManifest = text => {
  let doc
  try { doc = JSON.parse(text) } catch (e) { return { error: MANIFEST_PATH + ' is not JSON: ' + e.message } }
  if (!doc || !Array.isArray(doc.units) || !doc.units.length) return { error: MANIFEST_PATH + ': units must be a non-empty list' }
  const units = []
  for (const [i, u] of doc.units.entries()) {
    const at = MANIFEST_PATH + ' units[' + i + ']'
    if (!u || !isText(u.unit)) return { error: at + ': unit must name the unit' }
    if (!Array.isArray(u.carriers) || !u.carriers.length) return { error: at + ': carriers must be a non-empty list' }
    const carriers = []
    for (const [j, c] of u.carriers.entries()) {
      const where = at + '.carriers[' + j + ']'
      const exact = c && isText(c.path) && c.dir === undefined && c.file === undefined
      const dir = c && c.path === undefined && isText(c.dir) && isText(c.file)
      if (!exact && !dir) return { error: where + ': give either path, or dir and file' }
      const read = readerOf(c.read, where)
      if (typeof read === 'string') return { error: read }
      carriers.push(exact ? { path: c.path, read } : { dir: c.dir.replace(/\/+$/, ''), file: c.file, read })
    }
    units.push({ unit: u.unit, carriers })
  }
  return { units }
}

const pathsOf = (carrier, tree) => (carrier.path ? [carrier.path]
  : tree.list(carrier.dir).filter(p => p.endsWith('/' + carrier.file)))

// Every carrier whose version on the head is not the base's: [{unit, path, base, head}],
// in the order of the manifest. Only a carrier present in both trees is compared — a
// file the change adds or removes (a new skill) raises nothing; a version that cannot be
// read on one side (null) differs from a readable one.
export const unitVersionDrift = (units, base, head) => {
  const differs = []
  for (const { unit, carriers } of units)
    for (const carrier of carriers) {
      const paths = [...new Set([...pathsOf(carrier, base), ...pathsOf(carrier, head)])].sort()
      for (const path of paths) {
        const [b, h] = [base.read(path), head.read(path)]
        if (b === null || h === null) continue
        const [vb, vh] = [carrier.read(b), carrier.read(h)]
        if (vb !== vh) differs.push({ unit, path, base: vb, head: vh })
      }
    }
  return differs
}

// Every carrier at an exact path present in both trees whose version neither side can
// read: unitVersionDrift sees null = null there, so a raise in a new form of the carrier
// would pass unseen. Such a carrier is unchecked, never equal. A file of a directory
// carrier without a version is not one: such a file need not carry it.
export const unreadableCarriers = (units, base, head) => units.flatMap(({ carriers }) => carriers)
  .filter(c => c.path)
  .filter(({ path, read }) => {
    const [b, h] = [base.read(path), head.read(path)]
    return b !== null && h !== null && read(b) === null && read(h) === null
  })
  .map(c => c.path)
