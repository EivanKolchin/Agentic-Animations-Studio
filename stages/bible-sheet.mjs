/**
 * The bible, as a picture.
 *
 * A style bible is the most consequential file in the studio - every
 * prompt is assembled from it and every palette gate measures against it
 * - and it is a JSON file, which is the one form in which a set of
 * colours cannot be judged. Fourteen hexes read as fourteen hexes. Drawn
 * as swatches next to the references they were sampled from, they read as
 * a palette, and whether they are the right palette becomes a question
 * somebody can actually answer.
 */
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBible } from '../lib/bible.mjs'
import { oklab, hex } from '../lib/colour.mjs'
import { ensure, BIBLE } from '../lib/env.mjs'

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])

/** Black or white, whichever is legible on the swatch. Measured in OKLab
    rather than guessed from the hex, which is the same reason the gates
    measure there. */
const ink = (h) => (oklab(...hex(h))[0] > 0.62 ? '#1a1a1a' : '#ffffff')

function wrap(text, per) {
  const out = []
  let line = ''
  for (const w of String(text).split(/\s+/)) {
    if (!line) line = w
    else if (line.length + 1 + w.length <= per) line += ' ' + w
    else { out.push(line); line = w }
  }
  if (line) out.push(line)
  return out
}

export async function bibleSheet({ out, log = console.log } = {}) {
  const b = loadBible()
  const roles = Object.entries(b.palette).filter(([k]) => !k.startsWith('_'))
  const keys = [['keyColour', b.keyColour], ['darkKeyColour', b.darkKeyColour]].filter(([, v]) => v)

  const W = 980
  const pad = 28
  const sw = 128, sh = 96, gap = 12, keyH = 60
  const cols = Math.floor((W - pad * 2 + gap) / (sw + gap))
  const rows = Math.ceil(roles.length / cols)

  const idiom = wrap(b.idiom, 92)
  const bans = b.bans || []
  let y = pad

  const parts = []
  const text = (x, yy, s, { size = 13, weight = 400, fill = '#1a1a1a', family = 'ui-sans-serif,Segoe UI,Helvetica,Arial' } = {}) =>
    parts.push(`<text x="${x}" y="${yy}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`)

  text(pad, (y += 26), b.name || 'The style bible', { size: 24, weight: 700 })
  text(pad, (y += 22), 'bible/style.json - every prompt is assembled from this, and palette-conform measures against it', { size: 13, fill: '#5a5a56' })
  y += 18

  for (const line of idiom) text(pad, (y += 19), line, { size: 14.5 })
  y += 16

  // the palette
  text(pad, (y += 22), 'PALETTE', { size: 12, weight: 700, fill: '#5a5a56' })
  y += 10
  const top = y
  roles.forEach(([name, h], i) => {
    const c = i % cols, r = (i / cols) | 0
    const x = pad + c * (sw + gap)
    const yy = top + r * (sh + gap)
    parts.push(`<rect x="${x}" y="${yy}" width="${sw}" height="${sh}" rx="7" fill="${h}"/>`)
    text(x + 10, yy + 26, name, { size: 12.5, weight: 700, fill: ink(h) })
    text(x + 10, yy + 44, h, { size: 12, fill: ink(h), family: 'ui-monospace,Consolas,monospace' })
  })
  y = top + rows * (sh + gap) + 12

  // the key colours, which are not palette - they are what gets removed
  text(pad, (y += 22), 'KEYS - the backgrounds a subject is generated on, and what keying removes', { size: 12, weight: 700, fill: '#5a5a56' })
  y += 10
  keys.forEach(([name, h], i) => {
    const x = pad + i * (sw * 1.6 + gap)
    parts.push(`<rect x="${x}" y="${y}" width="${sw * 1.6}" height="${keyH}" rx="7" fill="${h}"/>`)
    text(x + 10, y + 24, name, { size: 12.5, weight: 700, fill: ink(h) })
    text(x + 10, y + 42, h, { size: 12, fill: ink(h), family: 'ui-monospace,Consolas,monospace' })
  })
  y += keyH + 22

  // light, surfaces, bans
  const rules = [
    ['LIGHT', typeof b.light === 'string' ? b.light : `${b.light.direction} - ${b.light.quality}`],
    ['SURFACES', `${b.texture}. Edges ${b.edges}.`],
    ['NEVER', bans.join('; ')],
  ]
  for (const [label, body] of rules) {
    text(pad, (y += 24), label, { size: 12, weight: 700, fill: '#5a5a56' })
    for (const line of wrap(body, 100)) text(pad, (y += 18), line, { size: 13.5 })
    y += 6
  }

  const H = Math.round(y + pad)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`
  const file = out || join(ensure(join(BIBLE, 'renders')), 'bible.png')
  const buf = await sharp({ create: { width: W, height: H, channels: 4, background: '#f4f3ef' } })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer()
  writeFileSync(file, buf)
  log(`  ${file}  ${W}x${H}  ${(buf.length / 1024).toFixed(1)} KB`)
  return file
}
