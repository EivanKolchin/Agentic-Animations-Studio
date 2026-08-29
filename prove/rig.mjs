/**
 * PROVE THE RIG - render parts with marked pivots and measure where they
 * actually landed.
 *
 * The rig is arithmetic pretending to be anatomy, and its failure mode is
 * not a crash. It is every limb sitting three pixels out of its socket,
 * which reads as "the rig is a bit loose" and gets fixed by nudging
 * numbers until it looks right at one angle and is wrong at every other.
 * A sign error in the rotation is worse: at small angles it looks like
 * slightly wrong easing.
 *
 * So each part carries a MARKER at its own pivot, in its own colour. The
 * frame is rendered, the markers are found, and their positions are
 * compared against what solve() said they would be. That checks the
 * chain, the composite offset and the sign convention in one measurement,
 * and it checks them against the picture rather than against the same
 * formula run twice.
 *
 * Run: npm run prove
 */
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensure, CACHE } from '../lib/env.mjs'
import { solve } from '../lib/rig.mjs'
import { renderPose } from '../lib/render.mjs'
import { poseAt, noise } from '../lib/motion.mjs'

const DIR = ensure(join(CACHE, 'prove-rig'))
const MARK = { body: [0, 0, 0], upper: [0, 200, 0], lower: [0, 0, 220] }

/** A limb: a plain bar with a 3px marker block at its declared pivot. */
async function limb(id, w, h, pivotPx, fill) {
  const [mr, mg, mb] = MARK[id]
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect x="0" y="0" width="${w}" height="${h}" rx="4" fill="${fill}"/>` +
    `<rect x="${pivotPx[0] - 1}" y="${pivotPx[1] - 1}" width="3" height="3" ` +
    `fill="rgb(${mr},${mg},${mb})"/></svg>`
  const file = join(DIR, id + '.png')
  writeFileSync(file, await sharp(Buffer.from(svg)).png().toBuffer())
  return file
}

/** Centroid of every pixel within 12 of a marker colour. */
async function findMark(buf, [r, g, b]) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0, sx = 0, sy = 0
  for (let i = 0; i < info.width * info.height; i++) {
    const p = i * 4
    if (data[p + 3] < 128) continue
    if (Math.abs(data[p] - r) < 12 && Math.abs(data[p + 1] - g) < 12 && Math.abs(data[p + 2] - b) < 12) {
      n++
      sx += i % info.width
      sy += (i / info.width) | 0
    }
  }
  return n ? [sx / n, sy / n] : null
}

await limb('body', 120, 40, [20, 20], '#c8c8c2')
await limb('upper', 90, 22, [8, 11], '#e8894a')
await limb('lower', 80, 18, [6, 9], '#7e9b7c')

const rig = {
  name: 'prover',
  dir: DIR,
  canvas: { w: 420, h: 300 },
  parts: [
    { id: 'body', file: 'body.png', at: [140, 150], pivotPx: [20, 20], z: 0 },
    { id: 'upper', file: 'upper.png', at: [240, 156], pivotPx: [8, 11], parent: 'body', z: 1 },
    { id: 'lower', file: 'lower.png', at: [320, 158], pivotPx: [6, 9], parent: 'upper', z: 2 },
  ],
}

let bad = 0
const say = (ok, what, detail) => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '\n        ' + detail : ''}`)
}

/* ---- 1. every marker lands where solve() says ---- */
for (const [name, pose] of [
  ['at rest', {}],
  ['one joint bent', { upper: 35 }],
  ['a chain, both bent', { upper: 35, lower: -50 }],
  ['bent the other way', { upper: -28, lower: 40 }],
]) {
  const buf = await renderPose(rig, pose)
  writeFileSync(join(DIR, 'pose-' + name.replace(/\W+/g, '-') + '.png'), buf)
  const solved = new Map(solve(rig, pose).map((s) => [s.id, s]))
  const off = []
  for (const id of ['body', 'upper', 'lower']) {
    const found = await findMark(buf, MARK[id])
    const want = solved.get(id).pivot
    if (!found) {
      off.push(`${id}: marker not in the frame at all`)
      continue
    }
    const d = Math.hypot(found[0] - want[0], found[1] - want[1])
    // A marker is 3px across and rotation resamples it, so its centroid
    // moves by up to half a pixel honestly. Anything past 1.5 is the
    // arithmetic being wrong, not the antialiasing.
    if (d > 1.5) off.push(`${id}: drawn at ${found.map((v) => v.toFixed(1))}, solved to ${want.map((v) => v.toFixed(1))}, ${d.toFixed(2)}px out`)
  }
  say(!off.length, `pivots land where the solve says - ${name}`, off.join('; '))
}

/* ---- 2. a child MOVES when its parent turns ---- */
// The check that catches a parent chain quietly not composing: with the
// child's own rotation at zero, its pivot must still travel, because the
// parent turned under it. Comparing renders would only prove something
// changed; this says by how much and in which direction.
{
  const rest = new Map(solve(rig, {}).map((s) => [s.id, s]))
  const bent = new Map(solve(rig, { upper: 40 }).map((s) => [s.id, s]))
  const moved = Math.hypot(
    bent.get('lower').pivot[0] - rest.get('lower').pivot[0],
    bent.get('lower').pivot[1] - rest.get('lower').pivot[1],
  )
  // The lower pivot sits 80px along the upper limb, so 40 degrees about
  // the upper's pivot is a chord of 2 * 80 * sin(20 deg) = 54.7px.
  const arm = Math.hypot(320 - 240, 158 - 156)
  const want = 2 * arm * Math.sin((40 * Math.PI) / 180 / 2)
  say(
    Math.abs(moved - want) < 0.5,
    'a child pivot rides its parent',
    `moved ${moved.toFixed(1)}px, geometry says ${want.toFixed(1)}px`,
  )
  say(
    Math.abs(bent.get('lower').angle - bent.get('upper').angle) < 1e-9,
    'a child with no rotation of its own inherits its parent angle',
  )
}

/* ---- 3. the motion is a function of time, with no seam ---- */
{
  const clip = {
    period: 2,
    channels: [
      { chain: ['upper', 'lower'], wave: { amp: 12, freq: 0.5 }, lag: 0.15, decay: 0.8 },
    ],
  }
  const a = poseAt(clip, 0)
  const b = poseAt(clip, 2) // exactly one period later
  const same = Math.abs(a.upper - b.upper) < 1e-9 && Math.abs(a.lower - b.lower) < 1e-9
  say(same, 'a clip returns to itself after one period, so a loop has no seam')

  // Follow-through: the second segment is doing what the first did, one
  // lag earlier - checked as a value, because "it looks laggy" is not a
  // check anybody can run twice.
  const t = 0.37
  const lead = poseAt(clip, t).upper
  const trail = poseAt(clip, t + 0.15).lower
  say(
    Math.abs(trail - lead * 0.8) < 1e-9,
    'the trailing segment repeats the leading one, one lag later',
    `lead ${lead.toFixed(3)} at t, trail ${trail.toFixed(3)} at t+lag (x0.8 decay)`,
  )

  // Acceleration continuity AT THE KNOTS, which is the only place it can
  // break. Sampled motion that kinks reads as a tick every whole second,
  // and a cubic fade is exactly how that gets in - its second derivative
  // is +-6 at the ends of each segment, so it JUMPS by twelve across
  // every integer while staying perfectly smooth in between.
  //
  // The first version of this check measured the MAGNITUDE of the second
  // difference over a fine grid, and passed the cubic happily: both fades
  // peak near six, so magnitude cannot tell them apart. It is the jump
  // that differs, and only within a few thousandths of a knot - measure
  // further out and the quintic's own curve swamps it.
  const d2 = (t, h = 0.001) => (noise(7, t + h) - 2 * noise(7, t) + noise(7, t - h)) / (h * h)
  let jump = 0, mag = 0
  for (let k = 1; k <= 8; k++) jump = Math.max(jump, Math.abs(d2(k + 0.004) - d2(k - 0.004)))
  for (let t = 0.1; t < 8; t += 0.03) mag = Math.max(mag, Math.abs(d2(t)))
  say(
    jump < 0.4 * mag,
    'acceleration is continuous across the noise knots, so nothing ticks on the second',
    `jump ${jump.toFixed(2)} against a peak of ${mag.toFixed(2)}`,
  )
}

/* ---- 4. the motion gates, each on its own defect ---- */
// Same rule as the picture gates: a gate is worth nothing until it has
// been watched refusing the thing it was written for AND accepting the
// thing next to it. Each clip below is correct except in one way.
{
  const { gates, config } = await import('../gates/index.mjs')
  const motion = (await gates()).filter((g) => g.tier === 'motion')
  const base = (over = {}) => ({
    period: 4,
    planted: ['body'],
    channels: [{ part: 'upper', wave: { amp: 20, freq: 0.25 } }],
    ...over,
  })
  const cases = [
    ['a clip with nothing wrong with it', base(), []],
    [
      'a frequency that does not divide the period',
      base({ channels: [{ part: 'upper', wave: { amp: 20, freq: 0.4 } }] }),
      ['motion-loop-seam'],
    ],
    [
      'smooth noise in a clip that claims to loop',
      base({ channels: [{ part: 'upper', wave: { amp: 20, freq: 0.25 }, noise: { amp: 4, freq: 0.3, seed: 2 } }] }),
      ['motion-loop-seam'],
    ],
    [
      'a phase that starts the still at full swing',
      base({ channels: [{ part: 'upper', wave: { amp: 20, freq: 0.25, phase: Math.PI / 2 } }] }),
      ['motion-still-honesty'],
    ],
    [
      'a planted part hanging off something that turns',
      base({ planted: ['lower'] }),
      ['motion-anchor-drift'],
    ],
    [
      'a joint turning far enough to step open',
      base({ channels: [{ part: 'lower', wave: { amp: 60, freq: 0.25 } }] }),
      ['motion-joint-seam'],
    ],
  ]
  for (const [name, clip, expect] of cases) {
    const failed = []
    for (const g of motion) {
      if (g.applies && !g.applies(clip, rig)) continue
      const r = await g.run({ rig, clip, clipName: 'prover', poseAt, solve, renderPose, cfg: config(null, clip, g.id) })
      if (r.pass === false) failed.push(g.id)
    }
    const missing = expect.filter((e) => !failed.includes(e))
    const extra = failed.filter((f) => !expect.includes(f))
    say(
      !missing.length && !extra.length,
      `motion gates: ${name}`,
      [
        missing.length ? `NOT CAUGHT: ${missing.join(', ')}` : '',
        extra.length ? `FIRED ANYWAY: ${extra.join(', ')}` : '',
        expect.length ? `expected ${expect.join(', ')}, got ${failed.join(', ') || '(none)'}` : `nothing failed`,
      ]
        .filter(Boolean)
        .join('; '),
    )
  }
}

/* ---- 5. the rig-tier gate: does the rest pose reproduce the source ---- */
// Built by rendering this rig at rest and calling that the canon, so a
// correct decomposition is true by construction and any break is visible
// against it.
{
  const { gates, config } = await import('../gates/index.mjs')
  const fidelity = (await gates()).find((g) => g.id === 'rig-rest-fidelity')
  writeFileSync(join(DIR, 'source.png'), await renderPose(rig, {}))
  const withSource = { ...rig, source: 'source.png' }
  const run = (r) => fidelity.run({ rig: r, renderPose, cfg: config(null, r, fidelity.id) })

  say((await run(withSource)).pass, 'rest fidelity: an intact rig reproduces its canon')

  // A box cut short - the defect that hides at rest and comes apart the
  // moment anything turns.
  const short = {
    ...withSource,
    parts: withSource.parts.map((p) => (p.id === 'lower' ? { ...p, file: 'upper.png' } : p)),
  }
  const r = await run(short)
  say(!r.pass, 'rest fidelity: a part swapped for the wrong art is refused', r.detail)

  // A part left out entirely.
  const missing = { ...withSource, parts: withSource.parts.filter((p) => p.id !== 'lower') }
  const r2 = await run(missing)
  say(!r2.pass, 'rest fidelity: an undeclared part is refused', r2.detail)
}

console.log(bad ? `\n${bad} rig checks wrong.\n` : `\nThe rig draws where it solves, the chain composes, the motion loops without a seam, and every gate fires on its own defect and on nothing else.\n`)
process.exitCode = bad ? 1 : 0
