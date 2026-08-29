/**
 * The brief, read back as data.
 *
 * A brief is markdown because it is argued over in conversation and has
 * to be readable by whoever inherits it. It is also the FIRST GATE, so
 * three things in it are read mechanically: whether it was approved, what
 * it is allowed to spend, and which assets it covers. Everything else is
 * prose for humans.
 *
 * Approval lives in the file rather than in a database or a flag, for the
 * same reason every other stage's state does: it survives the session
 * that recorded it, and it shows up in a diff.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function readBrief(dir) {
  const f = join(dir, 'brief.md')
  const text = readFileSync(f, 'utf8')
  // Scanned line by line rather than matched with one regex over the whole
  // file. A markdown section is "from this heading to the next heading",
  // which is three lines of loop and no lookahead - and the regex version
  // of it was silently returning nothing, which read as "the brief lists no
  // assets" and sent the author back to edit a file that was already right.
  const lines = text.split(/\r?\n/)
  const section = (name) => {
    const want = name.toLowerCase()
    const start = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, '').trim().toLowerCase() === want)
    if (start < 0) return ''
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((l) => /^##\s+/.test(l))
    return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
  }
  const assets = section('Assets')
    .split('\n')
    .map((l) => /^[-*]\s*([A-Za-z0-9][\w-]*)\s*:\s*(.+)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => ({ id: m[1], about: m[2].trim() }))
  const capM = /credit cap[^:]*:\s*([0-9]+)/i.exec(text)
  const approved = /^STATUS:\s*approved\b/mi.test(text)
  const byM = /^Approved by:\s*(.+?)\s*(?:on:\s*(.*))?$/mi.exec(text)
  return {
    file: f,
    text,
    approved,
    approvedBy: approved && byM ? byM[1].trim() : null,
    approvedOn: approved && byM ? (byM[2] || '').trim() : null,
    cap: capM ? Number(capM[1]) : null,
    assets,
    intent: section('Intent'),
    acceptance: section('Acceptance'),
  }
}

/** Record a human's approval in the file. The name and the date are the
    point: an approval with nobody's name on it is a checkbox. */
export function approveBrief(dir, by, on) {
  const f = join(dir, 'brief.md')
  let t = readFileSync(f, 'utf8')
  if (!/^STATUS:/mi.test(t)) throw new Error(`${f} has no STATUS line to approve.`)
  t = t.replace(/^STATUS:.*$/mi, `STATUS: approved`)
  t = /^Approved by:.*$/mi.test(t)
    ? t.replace(/^Approved by:.*$/mi, `Approved by: ${by}            on: ${on}`)
    : t.trimEnd() + `\n\n## Approval\n\nApproved by: ${by}            on: ${on}\n`
  writeFileSync(f, t)
  return f
}

export function requireApproved(brief) {
  if (!brief.approved) {
    throw new Error(
      `${brief.file} is not approved.\n\n` +
        'The brief is the first gate and the cheapest one: everything after it costs\n' +
        'credits, and a production that was never agreed is a production whose output\n' +
        'gets argued with at the delivery gate instead, after it has been paid for.\n\n' +
        'When it has genuinely been agreed:  node run.mjs approve <production> --by "<name>"',
    )
  }
}
