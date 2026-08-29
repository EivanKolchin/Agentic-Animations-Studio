/**
 * SELECT - put the survivors side by side, then record a choice.
 *
 * Two commands, and the split is deliberate. `sheet` renders every
 * surviving candidate for an asset onto one contact sheet; `pick` writes
 * the decision to select.json. Nothing downstream reads anything but
 * select.json, so a pick made by a human looking at a sheet and a pick
 * made by an agent reading the report are the same kind of fact, and both
 * are in git.
 *
 * The sheet is the ONLY point in the pipeline that asks anyone to look at
 * pictures, which is why the failures are drawn on it too, labelled with
 * why they went. A sheet of survivors alone hides the most useful thing
 * in a round: what the model kept doing wrong.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { contactSheet } from '../lib/sheet.mjs'
import { ensure } from '../lib/env.mjs'

function latestReport(dir) {
  const reports = join(dir, 'reports')
  if (!existsSync(reports)) return null
  const rounds = readdirSync(reports)
    .map((f) => /^round-(\d+)\.json$/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]))
  if (!rounds.length) return null
  const n = Math.max(...rounds)
  return { n, ...JSON.parse(readFileSync(join(reports, `round-${n}.json`), 'utf8')) }
}

export async function sheet(dir, { only, log = console.log } = {}) {
  const report = latestReport(dir)
  if (!report) throw new Error('No validation report yet. Run: node run.mjs validate <production>')
  const picked = existsSync(join(dir, 'select.json'))
    ? JSON.parse(readFileSync(join(dir, 'select.json'), 'utf8'))
    : {}
  const renders = ensure(join(dir, 'renders'))
  const out = []
  for (const a of report.assets) {
    if (only && !only.includes(a.id)) continue
    const items = a.candidates.map((c) => {
      const broke = c.gates.find((g) => g.pass === false)
      return {
        file: join(dir, 'raw', c.file),
        label: c.file.replace(/\.png$/, ''),
        note: c.pass
          ? `kept - ${c.score}${c.vision && !c.vision.error ? `, style ${c.vision.onStyle}/model ${c.vision.onModel}` : ''}`
          : broke
            ? `${broke.id}: ${broke.detail}`
            : `vision: ${c.vision?.drift || 'dropped'}`,
        verdict: picked[a.id] === c.file ? 'pick' : c.pass ? 'pass' : 'fail',
      }
    })
    const file = join(renders, `contact-${a.id}-r${report.n}.png`)
    const r = await contactSheet(items, file, { title: `${a.id} - round ${report.n}` })
    log(`  ${file}  ${r.w}x${r.h}  ${r.kb} KB`)
    out.push(file)
  }
  return out
}

export function pick(dir, choices, { log = console.log } = {}) {
  const f = join(dir, 'select.json')
  const cur = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
  const raw = join(dir, 'raw')
  for (const [id, choice] of Object.entries(choices)) {
    // Accept "fox-03", "03" or the whole filename: the sheet labels are the
    // first, the report lists the last, and being told off for typing the
    // one that was in front of you is a bad system.
    const named = choice.endsWith('.png') ? choice : `${choice}.png`
    const full = named.startsWith(id + '-') ? named : `${id}-${named}`
    if (!existsSync(join(raw, full))) throw new Error(`No such candidate: raw/${full}`)
    cur[id] = full
    log(`  ${id} -> ${full}`)
  }
  writeFileSync(f, JSON.stringify(cur, null, 2) + '\n')
  return cur
}
