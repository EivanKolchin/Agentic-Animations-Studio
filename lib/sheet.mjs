/**
 * Contact sheets - the only thing a human is asked to look at.
 *
 * Selection is a visual judgement and it is made badly one picture at a
 * time: a candidate seen alone looks fine, and the same candidate beside
 * five others is obviously the one whose light is wrong. So survivors are
 * always shown together, at the same size, on the same ground.
 *
 * The ground is a mid grey on purpose. Art keyed on magenta and art keyed
 * on charcoal both have to be readable here, and either of those as the
 * sheet's background would hide the very edge defects the sheet is for.
 */
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { load, downscale, pipe } from './image.mjs'

const esc = (s) =>
  String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])

/**
 * Break a reason into lines that fit under a cell.
 *
 * Estimated from the character count rather than measured, because
 * measuring means a font metric table for a caption. The estimate errs
 * SHORT - a clipped word is a reason someone can still act on, and a
 * reason running off the edge of the sheet is not, which is what a single
 * truncated line was doing.
 */
function wrap(note, cell, lines = 2) {
  if (!note) return []
  const per = Math.max(12, Math.floor(cell / 6.3))
  const out = []
  let line = ''
  for (const word of String(note).split(/\s+/)) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= per) line += ' ' + word
    else {
      out.push(line)
      line = word
      if (out.length === lines) break
    }
  }
  if (out.length < lines && line) out.push(line)
  if (out.length === lines) out[lines - 1] = out[lines - 1].slice(0, per - 1) + (note.length > out.join(' ').length ? '...' : '')
  return out
}

/**
 * @param items [{ file, label, note, verdict: 'pass'|'fail'|'pick'|null }]
 */
export async function contactSheet(items, out, { cell = 320, cols, title = '' } = {}) {
  if (!items.length) throw new Error('Nothing to put on a contact sheet.')
  const n = items.length
  const C = cols || Math.min(4, Math.ceil(Math.sqrt(n)))
  const R = Math.ceil(n / C)
  const pad = 16
  const cap = 64 // caption strip: a label and up to two lines of reason
  const head = title ? 44 : 0
  const W = pad + C * (cell + pad)
  const H = head + pad + R * (cell + cap + pad)

  const tiles = []
  const marks = []
  for (let i = 0; i < n; i++) {
    const it = items[i]
    const c = i % C, r = (i / C) | 0
    const x = pad + c * (cell + pad)
    const y = head + pad + r * (cell + cap + pad)
    const img = downscale(await load(it.file), cell)
    const fitted = await pipe(img)
      .resize({ width: cell, height: cell, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    tiles.push({ input: fitted, left: x, top: y })
    const colour = it.verdict === 'fail' ? '#c8402f' : it.verdict === 'pick' ? '#2e8b57' : it.verdict === 'pass' ? '#5a6b58' : '#6a6a6a'
    marks.push(
      `<rect x="${x - 2}" y="${y - 2}" width="${cell + 4}" height="${cell + 4}" fill="none" stroke="${colour}" stroke-width="${it.verdict === 'pick' ? 4 : 2}"/>` +
        `<text x="${x}" y="${y + cell + 20}" font-family="ui-sans-serif,Segoe UI,Helvetica,Arial" font-size="15" font-weight="600" fill="#111">${esc(it.label)}</text>` +
        wrap(it.note, cell).map(
          (line, k) =>
            `<text x="${x}" y="${y + cell + 38 + k * 15}" font-family="ui-sans-serif,Segoe UI,Helvetica,Arial" font-size="12.5" fill="${colour}">${esc(line)}</text>`,
        ).join(''),
    )
  }
  const overlay =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    (title
      ? `<text x="${pad}" y="30" font-family="ui-sans-serif,Segoe UI,Helvetica,Arial" font-size="19" font-weight="700" fill="#111">${esc(title)}</text>`
      : '') +
    marks.join('') +
    '</svg>'

  const buf = await sharp({ create: { width: W, height: H, channels: 4, background: '#b9b9b6' } })
    .composite([...tiles, { input: Buffer.from(overlay) }])
    .png()
    .toBuffer()
  writeFileSync(out, buf)
  return { out, w: W, h: H, kb: +(buf.length / 1024).toFixed(1) }
}
