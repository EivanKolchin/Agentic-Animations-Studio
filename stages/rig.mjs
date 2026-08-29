/**
 * RIG - cut the canon into parts and measure the joints.
 *
 * The canon is one generation, kept forever. This stage turns it into
 * something that can move without being drawn again: boxes cut out of the
 * source, each with a declared pivot, each parented to another.
 *
 * NOTHING IS PLACED BY HAND. A part's rest position is derived from the
 * box it was cut from, so the parts are registered to the source by
 * construction and a re-cut cannot shift them. That matters because the
 * alternative - cut the parts, then position each one until it looks
 * right - is a set of numbers that were true for one arrangement of the
 * art and silently wrong for the next.
 *
 * The parts are NOT trimmed either, for the same reason: trimming moves
 * the pivot inside the image, so a part whose art happens to end two
 * pixels earlier would hang two pixels off its joint.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { load, save, crop, coverage } from '../lib/image.mjs'
import { checkRig, inOrder } from '../lib/rig.mjs'
import { CANON, ensure } from '../lib/env.mjs'

/** Promote a cut asset into the canon. This is the moment a picture stops
    being a candidate and becomes the character. */
export function promote(name, fromFile, { log = console.log } = {}) {
  if (!existsSync(fromFile)) throw new Error(`No such file: ${fromFile}`)
  const dir = ensure(join(CANON, name))
  const ext = fromFile.endsWith('.png') ? '.png' : '.webp'
  const dest = join(dir, 'source' + ext)
  if (existsSync(dest)) {
    throw new Error(
      `${dest} already exists.\n\n` +
        'A canon is generated once and then never again - that is the whole of\n' +
        'why a character stops drifting. Replacing it silently would make every\n' +
        'rig, pose and render built on it wrong in a way nothing would report.\n' +
        'Delete it deliberately if the character is genuinely being redrawn.',
    )
  }
  copyFileSync(fromFile, dest)
  log(`${name} is canon: ${dest}`)
  if (!existsSync(join(dir, 'parts.json'))) {
    writeFileSync(
      join(dir, 'parts.json'),
      JSON.stringify(
        {
          _: 'Boxes are [left, top, width, height] as fractions of the source. Pivot is [x, y] as a fraction of the PART, and is the joint it turns about.',
          name,
          parts: [
            { id: 'body', box: [0.3, 0.4, 0.4, 0.3], pivot: [0.5, 0.5], z: 0 },
            { id: 'head', box: [0.6, 0.25, 0.25, 0.3], pivot: [0.2, 0.8], parent: 'body', z: 1 },
          ],
          clips: {
            idle: {
              period: 2,
              channels: [{ part: 'head', wave: { amp: 3, freq: 0.5 } }],
            },
          },
        },
        null,
        2,
      ) + '\n',
    )
    log(`Wrote ${join(dir, 'parts.json')} - declare the real boxes, then: node run.mjs rig ${name}`)
  }
  return dest
}

export async function rig(name, { log = console.log } = {}) {
  const dir = join(CANON, name)
  const partsFile = join(dir, 'parts.json')
  if (!existsSync(partsFile)) {
    throw new Error(`No ${partsFile}. Promote a cut asset first:\n  node run.mjs canon ${name} --from <production>/<asset>`)
  }
  const src = ['source.png', 'source.webp'].map((f) => join(dir, f)).find(existsSync)
  if (!src) throw new Error(`No source image in ${dir}.`)

  const decl = JSON.parse(readFileSync(partsFile, 'utf8'))
  const source = await load(src)
  const outDir = ensure(join(dir, 'parts'))
  const parts = []
  // The UNION of the boxes, not the sum of them. Adding each part's own
  // filled area reported 122% of a subject on the first rig it was run on,
  // because a head box and a body box overlap - and a number that can
  // exceed 100 can never trip the warning it exists to raise.
  const covered = new Uint8Array(source.w * source.h)

  for (const p of decl.parts) {
    const [fl, ft, fw, fh] = p.box
    const box = {
      left: Math.round(fl * source.w),
      top: Math.round(ft * source.h),
      width: Math.round(fw * source.w),
      height: Math.round(fh * source.h),
    }
    const piece = crop(source, box)
    const fill = coverage(piece)
    if (fill < 0.005) {
      throw new Error(
        `Part "${p.id}" is empty - its box holds ${(fill * 100).toFixed(1)}% subject.\n` +
          'A box measured off the wrong image, or fractions typed as pixels.',
      )
    }
    for (let y = box.top; y < box.top + box.height; y++) {
      if (y < 0 || y >= source.h) continue
      for (let x = box.left; x < box.left + box.width; x++) {
        if (x >= 0 && x < source.w) covered[y * source.w + x] = 1
      }
    }
    const file = `parts/${p.id}.png`
    await save(piece, join(dir, file), { format: 'png' })
    parts.push({
      id: p.id,
      file,
      parent: p.parent,
      z: p.z ?? 0,
      // Rest position: where this part's pivot sits in SOURCE pixels.
      // Derived, never typed.
      at: [box.left + p.pivot[0] * box.width, box.top + p.pivot[1] * box.height],
      pivotPx: [p.pivot[0] * box.width, p.pivot[1] * box.height],
      box,
      fill: +fill.toFixed(3),
    })
    log(`  ${p.id.padEnd(12)} ${box.width}x${box.height}  ${(fill * 100).toFixed(0)}% subject  pivot at ${parts.at(-1).at.map(Math.round).join(',')}`)
  }

  const out = {
    name: decl.name || name,
    canvas: { w: source.w, h: source.h },
    source: src.split(/[\\/]/).pop(),
    parts,
    clips: decl.clips || {},
  }
  const problems = checkRig({ ...out, dir })
  if (problems.length) throw new Error(`The rig is not renderable:\n  - ${problems.join('\n  - ')}`)
  inOrder(out) // throws on a loop, before anything downstream hangs on one

  // How much of the character the parts account for. A limb nobody
  // declared is a limb that vanishes the moment the rig is rendered
  // instead of the source, and it is invisible in the parts list.
  let subject = 0, kept = 0
  for (let i = 0; i < source.w * source.h; i++) {
    if (source.data[i * 4 + 3] < 128) continue
    subject++
    if (covered[i]) kept++
  }
  const share = subject ? kept / subject : 0
  log(`  ${'coverage'.padEnd(12)} the parts account for ${(share * 100).toFixed(0)}% of the subject`)
  if (share < 0.85) {
    log(`  WARNING: ${(100 - share * 100).toFixed(0)}% of the subject is in no part and will disappear when the rig renders.`)
  }

  writeFileSync(join(dir, 'rig.json'), JSON.stringify(out, null, 2) + '\n')
  return { file: join(dir, 'rig.json'), parts: parts.length, share }
}
