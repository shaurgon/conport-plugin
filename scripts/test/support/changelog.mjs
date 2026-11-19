// The sections of a unit's changelog, read the same way before and after a
// release. An epic writes its changes into the first section of a changelog;
// the release step turns that section's heading into the version number. So no
// test names a heading as the place of an entry: the newest section is
// `topSection`, and an entry that shipped earlier is the section `sectionWith`
// finds by its words. This is the one place of the plugin's tests that knows how
// a changelog is cut into sections; `headingLiterals` keeps it the only one.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

// A heading of a section: a line that starts with `## `.
const HEADING = /^## .*$/m

// A string literal that names the heading of a section as a place: a quote,
// optionally a line break or a regex anchor, then the open heading or a version
// number. A heading quoted inside prose (between backquotes) is not one.
const HEADING_LITERAL = /['"](?:\\n|\^)*## (?:Unreleased|\d+\.\d+\.\d+)/

const flat = (text) => text.replace(/\s+/g, ' ').trim()

/** The text of each section, newest first: from the line after a `## `
 * heading up to the next one, the heading left out. */
export function sections(changelog) {
  const parts = changelog.split(HEADING)
  assert.ok(parts.length > 1, "the changelog has no '## ' section")
  return parts.slice(1)
}

/** The first section, whatever its heading: the open one while an epic fills
 * it, the version once the release step has numbered it. */
export function topSection(changelog) {
  return sections(changelog)[0]
}

/** The newest section that holds `words`, with runs of whitespace read as one
 * space on both sides, so a sentence is found however it is wrapped. */
export function sectionWith(changelog, words) {
  const wanted = flat(words)
  const found = sections(changelog).find((section) => flat(section).includes(wanted))
  assert.ok(found !== undefined, `no section of the changelog holds: ${wanted}`)
  return found
}

/** `name:line` of every line of `paths` with a string literal that names the
 * heading of a section: the open one or a version. */
export function headingLiterals(paths) {
  const found = []
  for (const path of paths) {
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (HEADING_LITERAL.test(line)) found.push(`${basename(path)}:${index + 1}`)
      })
  }
  return found
}
