/**
 * Render a posed rig, offline.
 *
 * No browser and no canvas element: parts are rotated and composited by
 * sharp, which means the same code renders a preview strip, a frame stack
 * for ffmpeg, and whatever a site ends up asking for - from one set of
 * numbers, on a machine with no display. That is also what makes motion
 * checkable by a gate: a frame is a buffer, and two buffers can be
 * compared.
 *
 * The only subtle part is where a rotated part goes. sharp's rotate grows
 * the canvas to fit and keeps the original centred, so the pivot moves
 * inside its own image; `rotatedPivot` says where to, and the composite
 * offset is the world pivot minus that. Get it wrong and every limb sits
 * a few pixels out of its socket, which reads as a loose rig rather than
 * as arithmetic - so it is derived rather than nudged.
 */
import sharp from 'sharp'
import { join } from 'node:path'
import { solve, rotatedPivot } from './rig.mjs'

const cache = new Map()

async function part(rig, p) {
  const key = join(rig.dir, p.file)
  if (!cache.has(key)) {
    const buf = await sharp(key).ensureAlpha().png().toBuffer()
    const meta = await sharp(buf).metadata()
    cache.set(key, { buf, w: meta.width, h: meta.height })
  }
  return cache.get(key)
}

/** One frame, as a PNG buffer. */
export async function renderPose(rig, pose, { scale = 1, background = null } = {}) {
  const W = Math.round(rig.canvas.w * scale)
  const H = Math.round(rig.canvas.h * scale)
  const layers = []
  for (const s of solve(rig, pose)) {
    const img = await part(rig, s.part)
    const deg = (s.angle * 180) / Math.PI
    // sharp rotates clockwise for a positive angle, and image space has y
    // pointing down, so the standard rotation matrix and sharp agree on
    // sign with no correction. Proved rather than assumed: prove-rig.mjs
    // renders a part with a marked pivot and checks the marker lands where
    // this says it will.
    const rotated = Math.abs(deg) < 1e-6
      ? img.buf
      : await sharp(img.buf).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    const r = rotatedPivot(img.w, img.h, s.part.pivotPx, s.angle)
    let input = rotated
    let ox = s.pivot[0] - r.x
    let oy = s.pivot[1] - r.y
    if (scale !== 1) {
      const m = await sharp(rotated).metadata()
      input = await sharp(rotated).resize({ width: Math.max(1, Math.round(m.width * scale)) }).png().toBuffer()
      ox *= scale
      oy *= scale
    }
    layers.push({ input, left: Math.round(ox), top: Math.round(oy) })
  }
  return sharp({
    create: { width: W, height: H, channels: 4, background: background || { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(layers)
    .png()
    .toBuffer()
}

/** A row of frames at given times, as one image. The strip is how motion
    is read without a player: a loop that snaps shows as a jump between
    the last cell and the first. */
export async function tStrip(rig, clip, times, out, { scale = 0.5, background = '#b9b9b6', poseAt } = {}) {
  const cells = []
  for (const t of times) cells.push(await renderPose(rig, poseAt(clip, t), { scale }))
  const W = Math.round(rig.canvas.w * scale)
  const H = Math.round(rig.canvas.h * scale)
  const pad = 8
  const label = 22
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pad + times.length * (W + pad)}" height="${H + label + pad * 2}">` +
    times
      .map(
        (t, i) =>
          `<text x="${pad + i * (W + pad)}" y="${H + pad + 15}" font-family="ui-sans-serif,Segoe UI,Helvetica,Arial" font-size="12.5" fill="#333">t = ${t.toFixed(2)}s</text>`,
      )
      .join('') +
    '</svg>'
  const buf = await sharp({
    create: {
      width: pad + times.length * (W + pad),
      height: H + label + pad * 2,
      channels: 4,
      background,
    },
  })
    .composite([
      ...cells.map((input, i) => ({ input, left: pad + i * (W + pad), top: pad })),
      { input: Buffer.from(svg) },
    ])
    .png()
    .toBuffer()
  const { writeFileSync } = await import('node:fs')
  writeFileSync(out, buf)
  return { out, frames: times.length, kb: +(buf.length / 1024).toFixed(1) }
}
