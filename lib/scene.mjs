/**
 * A scene: rigs and backdrops placed in one world, cropped into frames.
 *
 * THE WORLD IS RENDERED ONCE PER INSTANT AND CROPPED AFTERWARDS. That is
 * the whole reason a 16:9 site loop and a 9:16 clip are the same
 * animation rather than two that resemble each other: they are two
 * rectangles taken from the same pixels, so they cannot drift apart,
 * cannot be re-timed differently, and cannot have one fixed without the
 * other. Compose per output and you have two scenes to maintain within a
 * month.
 *
 * The world is therefore generous - taller and wider than any single
 * output - and each frame declares the rectangle it takes. That
 * rectangle is a CAMERA, and the one thing a camera can do wrong here is
 * cut a subject in half, which is why a layer can declare that it must
 * survive every crop.
 */
import sharp from 'sharp'
import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute, resolve, dirname } from 'node:path'
import { loadRig } from './rig.mjs'
import { poseAt } from './motion.mjs'
import { renderPose } from './render.mjs'
import { CANON, STUDIO } from './env.mjs'

const SCENES = join(STUDIO, 'scenes')

export function loadScene(name) {
  const f = name.endsWith('.json') ? name : join(SCENES, name + '.json')
  if (!existsSync(f)) throw new Error(`No scene at ${f}.`)
  const s = JSON.parse(readFileSync(f, 'utf8'))
  s.file = f
  s.dir = dirname(f)
  return s
}

export function checkScene(s) {
  const problems = []
  if (!s.world?.w || !s.world?.h) problems.push('no world size')
  if (!s.layers?.length) problems.push('no layers')
  if (!s.frames || !Object.keys(s.frames).length) problems.push('no frames declared - nothing would be output')
  for (const [name, f] of Object.entries(s.frames || {})) {
    if (!Array.isArray(f.crop) || f.crop.length !== 4) problems.push(`frame "${name}" has no crop rectangle`)
    if (!Array.isArray(f.out) || f.out.length !== 2) problems.push(`frame "${name}" has no output size`)
    if (f.crop && s.world) {
      const [x, y, w, h] = f.crop
      if (x < 0 || y < 0 || x + w > s.world.w || y + h > s.world.h) {
        problems.push(`frame "${name}" crops outside the world`)
      }
    }
  }
  for (const l of s.layers || []) {
    if (!l.id) problems.push('a layer has no id')
    if (!l.image && !l.rig) problems.push(`layer "${l.id}" is neither an image nor a rig`)
    // A drifting layer whose frequency does not divide the period breaks
    // the loop for the whole scene, and it breaks it silently - the rigs
    // still close, so every motion gate still passes and only the cloud
    // jumps.
    // A traveller has to cross a WHOLE number of tiles in one period, or
    // every copy lands somewhere its neighbour was not and the sky jumps.
    if (l.drift?.tile && s.period) {
      const tiles = ((l.drift.vx ?? 0) * s.period) / l.drift.tile
      if (Math.abs(tiles - Math.round(tiles)) > 1e-9) {
        problems.push(
          `layer "${l.id}" travels ${(l.drift.vx ?? 0) * s.period}px in a ${s.period}s period, ` +
            `which is ${tiles.toFixed(3)} of its ${l.drift.tile}px tile - it would jump at the loop. ` +
            `Set vx to tile * n / period.`,
        )
      }
    }
    if (l.sway?.freq && s.period) {
      const cycles = l.sway.freq * s.period
      if (Math.abs(cycles - Math.round(cycles)) > 1e-9) {
        problems.push(
          `layer "${l.id}" drifts at ${l.sway.freq}Hz, which is ${cycles.toFixed(3)} cycles ` +
            `in a ${s.period}s period - it would jump at the loop. Use a frequency that divides the period.`,
        )
      }
    }
  }
  return problems
}

const cache = new Map()

async function backdrop(scene, layer, world, scale) {
  const key = layer.id + '|' + (layer.width || 'fill') + '|' + scale
  if (cache.has(key)) return cache.get(key)
  const file = isAbsolute(layer.image) ? layer.image : resolve(scene.dir, layer.image)
  if (!existsSync(file)) throw new Error(`Layer "${layer.id}" points at a file that is not there: ${file}`)
  let p = sharp(file)
  if (layer.fill) p = p.resize({ width: Math.round(world.w * scale), height: Math.round(world.h * scale), fit: 'cover' })
  else if (layer.width) p = p.resize({ width: Math.round(layer.width * scale) })
  else if (scale !== 1) {
    const m = await sharp(file).metadata()
    p = p.resize({ width: Math.round(m.width * scale) })
  }
  const buf = await p.png().toBuffer()
  const m = await sharp(buf).metadata()
  const v = { buf, w: m.width, h: m.height }
  cache.set(key, v)
  return v
}

/**
 * Where a layer's top-left corner goes.
 *
 * `anchor: "bottom"` puts `at` under the middle of the bottom edge, which
 * is how anything standing on ground is actually placed - a fox is at a
 * spot on the ground, not at a corner of its own bounding box, and
 * scaling it must not move that spot.
 */
function corner(layer, w, h) {
  const [x, y] = layer.at || [0, 0]
  switch (layer.anchor) {
    case 'bottom': return [Math.round(x - w / 2), Math.round(y - h)]
    case 'centre':
    case 'center': return [Math.round(x - w / 2), Math.round(y - h / 2)]
    default: return [Math.round(x), Math.round(y)]
  }
}

/**
 * A still layer's drift, in world pixels at time t.
 *
 * Clouds have to move or the sky is a photograph, and a still image has
 * no rig to move it. This is the same contract everything else here uses:
 * a function of time, closed form, so it loops when its frequency divides
 * the scene's period - which checkScene enforces rather than trusting.
 *
 * A sine rather than a constant velocity, because a constant velocity has
 * to wrap, and a wrap is a seam. A cloud that drifts out and back is not
 * what weather does, but at these amplitudes over twelve seconds nobody
 * reads it as a return - they read it as air moving.
 */
function drift(layer, t) {
  const s = layer.sway
  if (!s) return [0, 0]
  const w = 2 * Math.PI * (s.freq ?? 0)
  return [(s.x ?? 0) * Math.sin(w * t + (s.phase ?? 0)), (s.y ?? 0) * Math.sin(w * t + (s.phase ?? 0))]
}

/**
 * A layer that TRAVELS, tiled, the way clouds actually cross a sky.
 *
 * `sway` oscillates, which is right for a grass tuft rooted in the ground
 * and wrong for a cloud: weather goes one way. The site's own hero does
 * this - `((i * 620 + t * speed) % (W + 520)) - 420` - and it looks right
 * because the wrap happens while the cloud is off-frame.
 *
 * The loop is what makes it non-trivial. A single cloud travelling at a
 * constant speed cannot return to its start inside a short period without
 * moving absurdly fast. A TILED one can: place copies `tile` apart, move
 * them all at `vx`, and after `tile / vx` seconds every copy sits exactly
 * where its neighbour was. The picture is then identical and the loop is
 * perfect, at whatever gentle speed the spacing implies - which is why
 * `checkScene` requires vx * period to be a whole number of tiles.
 *
 * Returns the x offsets to draw this layer at, in world units.
 */
function tiled(layer, t, worldW, w) {
  const d = layer.drift
  if (!d?.tile) return [0]
  const offset = (((d.vx ?? 0) * t) % d.tile + d.tile) % d.tile
  const baseX = (layer.at || [0, 0])[0]
  const out = []
  const first = Math.floor((-w - baseX - offset) / d.tile)
  const last = Math.ceil((worldW - baseX - offset) / d.tile)
  for (let k = first; k <= last; k++) out.push(offset + k * d.tile)
  return out
}

/**
 * Every layer, placed, at one instant. Rig layers are posed; the pose
 * comes from the SCENE's clock, so everything in the world shares one
 * time and a phase is the only way to stagger two of the same thing.
 *
 * `scale` above 1 is SUPERSAMPLING, and it exists because the compositor
 * places layers at integer pixels. Gentle idle motion is sub-pixel per
 * frame - a body swaying 0.9 degrees over four seconds moves its
 * silhouette a fifth of a pixel between frames - so at 1x a part sits
 * still for several frames and then snaps a whole pixel sideways, which
 * reads as a glitch rather than as motion. Composing at 2x and
 * downscaling on output halves the snap and smooths the edges the
 * rotation resampled.
 *
 * Rig layers are rendered AT their combined scale rather than rendered
 * small and resampled up: the rotation, the part placement and the
 * rounding all happen at the resolution the pixels will actually keep.
 */
export async function composeWorld(scene, t, { scale = 1 } = {}) {
  const world = { w: Math.round(scene.world.w * scale), h: Math.round(scene.world.h * scale) }
  const layers = [...scene.layers].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
  const composites = []

  for (const l of layers) {
    if (l.hidden) continue
    let buf, w, h
    if (l.image) {
      const b = await backdrop(scene, l, scene.world, scale)
      buf = b.buf; w = b.w; h = b.h
    } else {
      const rig = loadRig(CANON, l.rig)
      const clip = rig.clips?.[l.clip]
      if (!clip) throw new Error(`Layer "${l.id}" wants clip "${l.clip}" of rig "${l.rig}", which has: ${Object.keys(rig.clips || {}).join(', ') || '(none)'}`)
      buf = await renderPose(rig, poseAt(clip, t + (l.phase || 0)), { scale: (l.scale ?? 1) * scale })
      const m = await sharp(buf).metadata()
      w = m.width; h = m.height
    }
    const d = drift(l, t)
    // A tiled traveller becomes several composites of the same buffer; an
    // ordinary layer is the single-offset case of the same loop.
    for (const dx of tiled(l, t, scene.world.w, w / scale)) {
      const at = [(l.at?.[0] ?? 0) + d[0] + dx, (l.at?.[1] ?? 0) + d[1]].map((v) => v * scale)
      const [x, y] = corner({ ...l, at }, w, h)
      composites.push({ input: buf, left: x, top: y, w, h, id: l.id })
    }
  }

  // Same trick the rig renderer needs: a layer may hang off an edge, and
  // sharp refuses a composite that does not fit. Build big, crop back.
  let minX = 0, minY = 0, maxX = world.w, maxY = world.h
  for (const c of composites) {
    minX = Math.min(minX, c.left); minY = Math.min(minY, c.top)
    maxX = Math.max(maxX, c.left + c.w); maxY = Math.max(maxY, c.top + c.h)
  }
  const padded = await sharp({
    create: { width: maxX - minX, height: maxY - minY, channels: 4, background: scene.background || { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites.map((c) => ({ input: c.input, left: c.left - minX, top: c.top - minY })))
    .png()
    .toBuffer()
  if (minX === 0 && minY === 0 && maxX === world.w && maxY === world.h) return padded
  return sharp(padded).extract({ left: -minX, top: -minY, width: world.w, height: world.h }).png().toBuffer()
}

/** One named frame, taken out of an already-composed world. */
export async function takeFrame(scene, worldBuf, frameName, { scale = 1 } = {}) {
  const f = scene.frames[frameName]
  if (!f) throw new Error(`No frame called "${frameName}". This scene has: ${Object.keys(scene.frames).join(', ')}`)
  const [x, y, w, h] = f.crop.map((v) => Math.round(v * scale))
  return sharp(worldBuf)
    .extract({ left: x, top: y, width: w, height: h })
    .resize({ width: f.out[0], height: f.out[1], fit: 'fill' })
    .png()
    .toBuffer()
}

/** The period the whole scene repeats on: its own, or the longest of the
    clips in it. A scene with no period is not a loop and nothing should
    pretend it is. */
export function scenePeriod(scene) {
  if (scene.period) return scene.period
  let p = 0
  for (const l of scene.layers) {
    if (!l.rig) continue
    try {
      const rig = loadRig(CANON, l.rig)
      p = Math.max(p, rig.clips?.[l.clip]?.period || 0)
    } catch {}
  }
  return p || 4
}
