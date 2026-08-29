/**
 * CUT - key, despill, erode, slice, trim, resize, manifest.
 *
 * This is the stage where a picture becomes an ASSET. Everything it does
 * is measured and written down, because the numbers it produces are what
 * the next thing along is built against: a scene lays sprites out by the
 * sizes in the manifest, and a rig hangs parts off the anchors in it. A
 * cut that reports nothing forces both of those to be measured by eye,
 * which is how layout constants turn into magic numbers.
 *
 * A sheet is sliced by ARITHMETIC over its declared grid, and that is
 * safe only because sheet-registration has already proved every cell
 * holds one subject clear of its gutters. The gate and the slice are two
 * halves of one mechanism; neither is sound alone.
 *
 * Cells are cut in FRACTIONS of the source, never pixels. The model
 * returns whatever resolution it feels like, and a sheet regenerated at a
 * different size has to keep slicing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { load, save, crop, bbox, topAnchor } from '../lib/image.mjs'
import { keyOut, erode } from '../lib/key.mjs'
import { loadBible } from '../lib/bible.mjs'
import { ensure } from '../lib/env.mjs'

export async function cut(dir, { only, log = console.log } = {}) {
  const s = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8'))
  const bible = loadBible()
  const selFile = join(dir, 'select.json')
  if (!existsSync(selFile)) {
    throw new Error(
      'Nothing has been selected. Run:\n' +
        '  node run.mjs sheet <production>                     look at the survivors\n' +
        '  node run.mjs pick <production> <asset>=<candidate>  record the choice',
    )
  }
  const sel = JSON.parse(readFileSync(selFile, 'utf8'))
  const out = ensure(join(dir, 'cut'))
  const sprites = []
  const anchors = {}

  for (const a of s.assets) {
    if (only && !only.includes(a.id)) continue
    const chosen = sel[a.id]
    if (!chosen) {
      log(`  ${a.id}: nothing picked, skipped`)
      continue
    }
    const src = join(dir, 'raw', chosen)
    const plan = a.cut || {}
    const key = a.key || bible.keyColour
    const source = await load(src)

    for (const piece of a.sheet ? sliceCells(a) : [{ name: a.id, fraction: plan.fraction || null }]) {
      const box = piece.fraction
        ? {
            left: Math.round(piece.fraction.left * source.w),
            top: Math.round(piece.fraction.top * source.h),
            width: Math.round(piece.fraction.width * source.w),
            height: Math.round(piece.fraction.height * source.h),
          }
        : null
      // crop() copies, so each piece keys its own pixels and the source
      // survives the loop unkeyed.
      const region = box ? crop(source, box) : crop(source, { left: 0, top: 0, width: source.w, height: source.h })
      if (key && !a.bleed) {
        keyOut(region, { keyColour: key, lo: a.keyLo, hi: a.keyHi })
        erode(region, plan.shrink ?? 2)
      }
      const trimBox = key && !a.bleed ? bbox(region, 1) : null
      const trimmed = trimBox ? crop(region, trimBox) : region
      const file = join(out, `${piece.name}.webp`)
      const r = await save(trimmed, file, { width: piece.width || plan.width, quality: plan.quality ?? 86 })
      anchors[piece.name] = { topX: topAnchor(trimmed) }
      sprites.push({ name: piece.name, from: chosen, ...r })
      log(`  ${piece.name.padEnd(20)} ${r.w}x${r.h}  ${r.kb} KB`)
    }
  }

  // A filtered run merges over the previous manifest. Whatever consumes
  // these reads every sprite's proportions from it, so re-cutting one
  // asset must never make the others vanish.
  const manifest = join(out, 'manifest.json')
  const prev = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : { sprites: [], anchors: {} }
  const byName = new Map(prev.sprites.map((x) => [x.name, x]))
  for (const x of sprites) byName.set(x.name, x)
  const all = [...byName.values()]
  writeFileSync(manifest, JSON.stringify({ sprites: all, anchors: { ...prev.anchors, ...anchors } }, null, 2) + '\n')
  log(`  ${'total'.padEnd(20)} ${all.reduce((t, x) => t + x.kb, 0).toFixed(1)} KB across ${all.length} sprites`)
  return { sprites, manifest }
}

/** The declared grid as fractional crop boxes, in reading order. */
function sliceCells(a) {
  const { cols, rows, cells, names } = a.sheet
  const out = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      out.push({
        name: names?.[i] || `${a.id}-${i + 1}`,
        fraction: { left: c / cols, top: r / rows, width: 1 / cols, height: 1 / rows },
        width: a.cut?.width,
        label: cells?.[i],
      })
    }
  }
  return out
}
