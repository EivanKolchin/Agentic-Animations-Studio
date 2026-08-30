/**
 * THE POSE MATH, AND NOTHING ELSE.
 *
 * Everything in this file is pure: no filesystem, no sharp, no Node
 * built-ins at all. That is the entire reason it is a separate file, and
 * the reason is not tidiness.
 *
 * A rig is a function of time. The studio evaluates it at 30 frames a
 * second to make a video; a BROWSER can evaluate the same function at
 * whatever t it likes - a clock, a scroll position, a slider - and get
 * the same pose, because it is the same arithmetic. That only stays true
 * if it is literally the same code. Two implementations of a bend chain
 * agree until the day one of them is fixed.
 *
 * So this file is what `deliver rig` ships to the consuming project,
 * verbatim. Anything imported here would have to ship too, which is why
 * nothing is.
 */

/* ------------------------------------------------------------------ *
 *  motion: a clip evaluated at a time
 * ------------------------------------------------------------------ */

/** Integer bit-mixer. Not fract(sin(n) * 43758.5): that one aliases on
    lattices like `part * 31.7 + step * 5.3`, which is exactly the shape a
    rig generates, and it once sent seven independent walks the same way. */
function hash(n) {
  let x = n | 0
  x = (x ^ 61) ^ (x >>> 16)
  x = (x + (x << 3)) | 0
  x = x ^ (x >>> 4)
  x = Math.imul(x, 0x27d4eb2d)
  x = x ^ (x >>> 15)
  return ((x >>> 0) % 100000) / 100000
}

/** Quintic fade: zero first AND second derivative at the ends. A cubic
    fade is continuous in value and kinks in velocity, which on a limb
    reads as a tick at every whole second. */
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)

/** Smooth value noise in one dimension, deterministic in (seed, t). */
export function noise(seed, t) {
  const i = Math.floor(t)
  const f = t - i
  const a = hash(i * 374761393 + seed * 668265263)
  const b = hash((i + 1) * 374761393 + seed * 668265263)
  return (a + (b - a) * fade(f)) * 2 - 1
}

const TAU = Math.PI * 2

/**
 * One channel's value at time t, in degrees.
 *
 * `wave` is a sine, `noise` is smooth drift, and a channel may carry both
 * - a tail that swings and also wanders is one channel, not two fighting
 * over the same part.
 */
function channelValue(ch, t) {
  let v = 0
  if (ch.wave) {
    const { amp = 0, freq = 0.5, phase = 0 } = ch.wave
    v += amp * Math.sin(TAU * freq * t + phase)
  }
  if (ch.noise) {
    const { amp = 0, freq = 0.3, seed = 1 } = ch.noise
    v += amp * noise(seed, freq * t)
  }
  if (ch.hold !== undefined) v += ch.hold
  return v
}

/**
 * A clip at time t, as a pose: { partId: degrees }.
 *
 * Channels ADD, so a chain's travelling wave and a whole-body sway can be
 * written separately and read as one movement. Two channels silently
 * replacing each other would make the order they were typed in matter,
 * which is the kind of rule nobody remembers at the point it bites.
 */
export function poseAt(clip, t) {
  const pose = {}
  const add = (id, v) => (pose[id] = (pose[id] || 0) + v)
  for (const ch of clip.channels || []) {
    if (ch.chain) {
      // Down the chain, each segment doing what the one before it did,
      // `lag` seconds later, and optionally softening as it goes.
      const lag = ch.lag ?? 0.1
      const decay = ch.decay ?? 1
      ch.chain.forEach((id, i) => add(id, channelValue(ch, t - i * lag) * decay ** i))
    } else if (ch.part) {
      add(ch.part, channelValue(ch, t - (ch.lag ?? 0)))
    }
  }
  return pose
}

/* ------------------------------------------------------------------ *
 *  rig: parts, pivots, parent chains
 * ------------------------------------------------------------------ */

/** Degrees, because a rig is authored by a person. Radians internally. */
const rad = (deg) => (deg * Math.PI) / 180

/**
 * Parts in an order where every parent comes before its children.
 *
 * Depth-first from the roots, and it throws on a cycle rather than
 * looping: a rig whose head is parented to its own ear is a typo, and a
 * renderer that hangs is a worse way to be told about it than a sentence.
 */
export function inOrder(rig) {
  const byId = new Map(rig.parts.map((p) => [p.id, p]))
  for (const p of rig.parts) {
    if (p.parent && !byId.has(p.parent)) throw new Error(`Part "${p.id}" is parented to "${p.parent}", which does not exist.`)
  }
  const out = []
  const state = new Map()
  const visit = (p, trail) => {
    const s = state.get(p.id)
    if (s === 'done') return
    if (s === 'open') throw new Error(`The parent chain loops: ${[...trail, p.id].join(' -> ')}`)
    state.set(p.id, 'open')
    if (p.parent) visit(byId.get(p.parent), [...trail, p.id])
    state.set(p.id, 'done')
    out.push(p)
  }
  for (const p of rig.parts) visit(p, [])
  return out
}

/**
 * Solve a pose into world transforms.
 *
 * pose is { partId: degrees } or { partId: { rot } }. A part not
 * mentioned is at rest, which is what makes a pose a DIFFERENCE from the
 * canon rather than a full description of it - a pose that has to name
 * every part is a pose that breaks when a part is added.
 */
export function solve(rig, pose = {}) {
  const out = new Map()
  for (const p of inOrder(rig)) {
    const local = rad(typeof pose[p.id] === 'object' ? (pose[p.id].rot ?? 0) : (pose[p.id] ?? 0))
    const parent = p.parent ? out.get(p.parent) : null
    const angle = (parent?.angle ?? 0) + local
    // The pivot rides on the parent: it is rotated about the PARENT's
    // pivot by the parent's accumulated angle. Compose, never re-solve
    // from the root, or a three-deep chain costs a chain-length loop per
    // part for an answer already sitting in the parent.
    let [x, y] = p.at
    if (parent) {
      const dx = x - parent.restPivot[0]
      const dy = y - parent.restPivot[1]
      const c = Math.cos(parent.angle), s = Math.sin(parent.angle)
      x = parent.pivot[0] + dx * c - dy * s
      y = parent.pivot[1] + dx * s + dy * c
    }
    out.set(p.id, { id: p.id, part: p, angle, pivot: [x, y], restPivot: p.at, z: p.z ?? 0 })
  }
  return [...out.values()].sort((a, b) => a.z - b.z)
}

/**
 * Where a part's pivot sits inside its own image after rotation.
 *
 * sharp's rotate grows the canvas to fit and keeps the original centred,
 * so the new size is |w cos| + |h sin| by |w sin| + |h cos| and the old
 * centre lands on the new centre. A browser rotating an element about a
 * transform-origin does not need this - it should set the origin to the
 * pivot and translate - but the studio's compositor does, and it is the
 * same geometry either way.
 */
export function rotatedPivot(w, h, pivotPx, angle) {
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle))
  const W = w * c + h * s
  const H = w * s + h * c
  const dx = pivotPx[0] - w / 2
  const dy = pivotPx[1] - h / 2
  const cc = Math.cos(angle), ss = Math.sin(angle)
  return { W, H, x: W / 2 + dx * cc - dy * ss, y: H / 2 + dx * ss + dy * cc }
}

/**
 * A part as a CSS/SVG transform, which is what a browser actually wants.
 *
 * Place the part's top-left at (pivot - pivotPx) and rotate about
 * pivotPx. No bounding-box arithmetic: the browser does that itself, and
 * asking it to reproduce the compositor's version would be two
 * implementations of one idea again.
 */
export function transformOf(solved) {
  const p = solved.part
  const deg = (solved.angle * 180) / Math.PI
  return {
    left: solved.pivot[0] - p.pivotPx[0],
    top: solved.pivot[1] - p.pivotPx[1],
    rotate: deg,
    origin: `${p.pivotPx[0]}px ${p.pivotPx[1]}px`,
    z: solved.z,
    id: solved.id,
    file: p.file,
  }
}
