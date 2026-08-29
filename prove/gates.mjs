/**
 * PROVE THE GATES - break the picture on purpose and watch each gate fire.
 *
 * A validator that passes proves nothing. It passes when it is right, and
 * it passes when it is reading the wrong array, comparing against
 * infinity, or has quietly stopped being called at all. The only evidence
 * that a gate works is a picture with the defect in it that the gate
 * refuses, next to a picture without it that the gate accepts.
 *
 * So every case here is a deliberate defect, and every case asserts BOTH
 * halves: the gate it targets fails, and the gates it does not target do
 * not - because a gate that fires on everything is not stricter, it is
 * broken, and it will be switched off within a week.
 *
 * The pictures are drawn here rather than loaded, so this runs in a fresh
 * clone with no art in it. Run: npm run prove
 */
import sharp from 'sharp'
import { validateFile } from '../lib/validate.mjs'
import { ensure, CACHE } from '../lib/env.mjs'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const KEY = '#ff00ff'
const DIR = ensure(join(CACHE, 'prove'))
const W = 480, H = 360

const BIBLE = {
  palette: { orange: '#e8642a', cream: '#f6e7cf', ink: '#3a2418' },
  gates: {},
}
const ASSET = { id: 'prover', key: KEY }

/** A subject: two flat shapes in bible colours, hard-edged, no gradient. */
function subjectSvg({ cx = W / 2, cy = H / 2, r = 90, colour = '#e8642a' } = {}) {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colour}"/>` +
    `<rect x="${cx - r * 0.4}" y="${cy - r * 0.2}" width="${r * 0.8}" height="${r * 0.9}" fill="#f6e7cf"/>`
  )
}

async function draw(name, { bg = KEY, svg = subjectSvg(), w = W, h = H }) {
  const file = join(DIR, name + '.png')
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`
  const buf = await sharp({ create: { width: w, height: h, channels: 4, background: bg } })
    .composite([{ input: Buffer.from(doc) }])
    .png()
    .toBuffer()
  writeFileSync(file, buf)
  return file
}

const cases = []
const add = (name, targets, make, asset = ASSET) => cases.push({ name, targets, make, asset })

/* ---- the control: nothing wrong with it ---- */
add('clean', [], () => draw('clean', {}))

/* ---- one defect each ---- */
add('background is a gradient, not a flat key', ['background-flat'], () =>
  draw('gradient', {
    bg: KEY,
    svg:
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="#ff00ff"/><stop offset="1" stop-color="#c800c8"/>` +
      `</linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>` +
      subjectSvg(),
  }),
)

add('the key colour appears inside the subject', ['key-collision'], () =>
  draw('collision', { svg: subjectSvg() + `<circle cx="${W / 2 + 40}" cy="${H / 2 + 30}" r="22" fill="${KEY}"/>` }),
)

// The halo is deliberately FAINT - bright enough to be seen, dim enough
// to stay on the background side of the key threshold. A stronger one is
// easier to catch and proves less: past the threshold its pixels join the
// subject, palette-conform fires too, and the case stops isolating the
// gate it was written for.
add('a soft halo around the subject', ['edge-halo'], () =>
  draw('halo', {
    svg:
      `<defs><radialGradient id="h"><stop offset="0.5" stop-color="#ff80ff"/>` +
      `<stop offset="1" stop-color="#ff00ff"/></radialGradient></defs>` +
      `<circle cx="${W / 2}" cy="${H / 2}" r="170" fill="url(#h)"/>` +
      subjectSvg(),
  }),
)

// Small and in a corner, on purpose: a subject that bleeds across half an
// edge also puts subject colour on the border, and then background-flat
// fires as well and the case no longer tells the two gates apart.
add('the subject runs off the edge of the frame', ['frame'], () =>
  draw('bleed', { svg: subjectSvg({ cx: 8, cy: 16, r: 18 }) }),
)

add('the subject is painted in a colour the bible does not name', ['palette-conform'], () =>
  draw('offpalette', { svg: subjectSvg({ colour: '#2f7bd6' }) }),
)

const SHEET = { ...ASSET, sheet: { cols: 3, rows: 2 } }
const cell = (c, r, extra = {}) =>
  subjectSvg({ cx: (c + 0.5) * (W / 3), cy: (r + 0.5) * (H / 2), r: 46, ...extra })

// The control for the sheet gate. Without it the two sheet cases below
// prove only that something fails, not that a good sheet passes.
add('a sheet with every cell filled and clear', [], () =>
  draw('sheet-clean', {
    w: W, h: H,
    svg: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]].map(([c, r]) => cell(c, r)).join(''),
  }),
  SHEET,
)

add('a sheet cell came back empty', ['sheet-registration'], () =>
  draw('sheet-empty', {
    w: W, h: H,
    svg: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]].map(([c, r]) => cell(c, r)).join(''),
  }),
  SHEET,
)

// The crossing is into an INTERIOR gutter. Growing a cell until it reaches
// the outside of the sheet is a different defect wearing this one's name,
// and it sets off frame and background-flat instead.
add('a sheet subject crosses its gutter', ['sheet-registration'], () =>
  draw('sheet-gutter', {
    w: W, h: H,
    svg: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]
      .map(([c, r], i) => cell(c, r, i === 0 ? { cx: 145 } : {}))
      .join(''),
  }),
  SHEET,
)

/* ---- run ---- */
let bad = 0
for (const c of cases) {
  const file = await c.make()
  const v = await validateFile(file, c.asset, BIBLE, { scale: 320 })
  const failed = v.results.filter((r) => r.pass === false).map((r) => r.id)
  const missing = c.targets.filter((t) => !failed.includes(t))
  const extra = failed.filter((f) => !c.targets.includes(f))
  const ok = !missing.length && !extra.length
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name}`)
  if (c.targets.length) console.log(`        expected to fail: ${c.targets.join(', ')}`)
  console.log(`        actually failed: ${failed.join(', ') || '(none)'}`)
  if (missing.length) console.log(`        NOT CAUGHT: ${missing.join(', ')} - the defect is in the picture and the gate did not see it`)
  if (extra.length) {
    console.log(`        FIRED ANYWAY: ${extra.join(', ')} - a gate that fails a picture it was not asked about`)
    for (const id of extra) console.log(`          ${id}: ${v.results.find((r) => r.id === id).detail}`)
  }
  for (const t of c.targets) {
    const r = v.results.find((x) => x.id === t)
    if (r) console.log(`        ${t}: ${r.detail}`)
  }
}
console.log(bad ? `\n${bad} of ${cases.length} cases wrong.\n` : `\nAll ${cases.length} cases behaved: every gate fires on its own defect and on nothing else.\n`)
process.exit(bad ? 1 : 0)
