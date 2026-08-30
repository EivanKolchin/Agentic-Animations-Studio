/**
 * PROVE THE SCENE - break the composition on purpose and watch it refuse.
 *
 * The scene layer arrived late and grew fast: two crops out of one world,
 * a gate that measures whether a subject survives them, and two separate
 * loop checks for layers that move without a rig. Every one of those was
 * proved ONCE, by hand, on the real meadow - which is exactly the kind of
 * evidence that stops being evidence the moment somebody edits the file.
 *
 * The fixtures here are drawn rather than loaded and use only IMAGE
 * layers, so this runs in a clone with no canon in it. That matters: the
 * scene machinery has to be provable without a character existing.
 *
 * Run: npm run prove
 */
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensure, CACHE } from '../lib/env.mjs'
import { checkScene, composeWorld, loadScene } from '../lib/scene.mjs'
import { gates, config } from '../gates/index.mjs'

const DIR = ensure(join(CACHE, 'prove-scene'))
const W = 400, H = 300

/** A flat square, so its pixel count is exactly known. */
async function block(name, size, colour) {
  const file = join(DIR, name + '.png')
  writeFileSync(
    file,
    await sharp({ create: { width: size, height: size, channels: 4, background: colour } }).png().toBuffer(),
  )
  return file
}

await block('subject', 40, '#e8642a')
await block('wide-thing', 120, '#467066')

/** A scene on disk, so it goes through the same loadScene every real one does. */
function scene(over = {}) {
  const s = {
    name: 'prover',
    world: { w: W, h: H },
    period: 12,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    frames: {
      // a wide band across the middle, and a narrow column on the left
      wide: { crop: [0, 60, 400, 180], out: [400, 180] },
      column: { crop: [20, 0, 120, 300], out: [120, 300] },
    },
    layers: [{ id: 'subject', image: 'subject.png', at: [70, 150], anchor: 'centre', z: 1, keep: true }],
    ...over,
  }
  const f = join(DIR, 'scene.json')
  writeFileSync(f, JSON.stringify(s, null, 2))
  return loadScene(f)
}

let bad = 0
const say = (ok, what, detail) => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '\n        ' + detail : ''}`)
}

const cropGate = (await gates()).find((g) => g.id === 'scene-crop')
const runCrop = (s) =>
  cropGate.run({ scene: s, composeWorld, cropOf: (f) => f.crop, cfg: config(null, s, cropGate.id) })

/* ---- 1. scene-crop: inside every frame, and outside one ---- */
{
  const inside = scene()
  const r = await runCrop(inside)
  say(r.pass, 'scene-crop: a subject inside every frame passes', r.detail)

  // x=300 is inside the wide band and well outside the left column
  const outside = scene({ layers: [{ id: 'subject', image: 'subject.png', at: [300, 150], anchor: 'centre', z: 1, keep: true }] })
  const r2 = await runCrop(outside)
  say(!r2.pass, 'scene-crop: a subject outside one frame is refused', r2.detail)

  // the SAME position without `keep` is not the gate's business
  const unkept = scene({ layers: [{ id: 'subject', image: 'subject.png', at: [300, 150], anchor: 'centre', z: 1 }] })
  const r3 = await runCrop(unkept)
  say(r3.pass, 'scene-crop: the same subject without keep is left alone', r3.detail)
}

/* ---- 2. the two loop checks, which fail SILENTLY in production ---- */
// Neither of these breaks a rig, so every motion gate still passes and
// only the sky is wrong. That is the whole reason they are checks rather
// than conventions.
{
  const ok = scene({ layers: [{ id: 'cloud', image: 'wide-thing.png', at: [0, 20], z: 0, sway: { x: 20, freq: 0.25 } }] })
  say(!checkScene(ok).length, 'a sway whose frequency divides the period is accepted')

  const badSway = scene({ layers: [{ id: 'cloud', image: 'wide-thing.png', at: [0, 20], z: 0, sway: { x: 20, freq: 0.2 } }] })
  const p1 = checkScene(badSway)
  say(p1.some((p) => /would jump at the loop/.test(p)), 'a sway that does not divide the period is refused', p1[0])

  const okDrift = scene({ layers: [{ id: 'cloud', image: 'wide-thing.png', at: [0, 20], z: 0, drift: { vx: 20, tile: 240 } }] })
  say(!checkScene(okDrift).length, 'a traveller crossing a whole tile per period is accepted')

  const badDrift = scene({ layers: [{ id: 'cloud', image: 'wide-thing.png', at: [0, 20], z: 0, drift: { vx: 23, tile: 240 } }] })
  const p2 = checkScene(badDrift)
  say(p2.some((p) => /whole number|jump at the loop/.test(p)), 'a traveller landing mid-tile is refused', p2[0])
}

/* ---- 3. the traveller actually loops, measured in pixels ---- */
// The check above is arithmetic on the declaration. This is the picture:
// the world at t=0 and at t=period must be the same bytes, or the claim
// that a scene loops is a claim nobody tested.
{
  const s = scene({
    period: 12,
    layers: [{ id: 'cloud', image: 'wide-thing.png', at: [0, 20], z: 0, drift: { vx: 20, tile: 240 } }],
  })
  // What this actually pins down, established by breaking the code four
  // ways: it is the OFFSET being periodic in t. Removing the modulo does
  // not break it (the copy range shifts to compensate, so the modulo only
  // keeps the numbers small), and mis-spacing the copies does not break it
  // either (the offset still returns to zero). Advancing at the wrong RATE
  // does break it, and so does not advancing at all - which is what the
  // companion check below is for.
  const [a, b] = await Promise.all([composeWorld(s, 0), composeWorld(s, s.period)])
  const [ra, rb] = await Promise.all([
    sharp(a).ensureAlpha().raw().toBuffer(),
    sharp(b).ensureAlpha().raw().toBuffer(),
  ])
  let differ = 0
  for (let i = 0; i < ra.length; i += 4) if (Math.abs(ra[i + 3] - rb[i + 3]) > 8) differ++
  say(differ === 0, 'a travelling layer is in the same place after one period', `${differ} pixels differ`)

  // and it has genuinely MOVED in between, or the test above passes on a
  // layer that never went anywhere
  const mid = await composeWorld(s, s.period / 4)
  const rm = await sharp(mid).ensureAlpha().raw().toBuffer()
  let moved = 0
  for (let i = 0; i < ra.length; i += 4) if (Math.abs(ra[i + 3] - rm[i + 3]) > 8) moved++
  say(moved > 500, 'and it moved in between, so the loop is not just a still', `${moved} pixels differ at a quarter period`)
}

/* ---- 4. an overhanging layer does not resize the world ---- */
// sharp refuses a composite bigger than its target, so the compositor
// builds big and crops back. A world that quietly grew would put every
// frame's crop rectangle somewhere else.
{
  const s = scene({
    layers: [{ id: 'over', image: 'wide-thing.png', at: [-80, -40], z: 0 }, ...scene().layers],
  })
  const buf = await composeWorld(s, 0)
  const m = await sharp(buf).metadata()
  say(m.width === W && m.height === H, 'a layer hanging off the edge leaves the world its declared size', `${m.width}x${m.height} against ${W}x${H}`)
}

console.log(bad ? `\n${bad} scene checks wrong.\n` : `\nThe scene crops what it promises, both loop checks refuse what would jump, and a traveller returns to where it started.\n`)
process.exitCode = bad ? 1 : 0
