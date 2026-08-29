/**
 * The rig: parts, pivots, parent chains, and the solve.
 *
 * A rig exists so a character is generated ONCE. Every later pose is
 * these same pixels rotated about declared joints, which is the only
 * arrangement in which a character cannot drift off-model - not because
 * anybody is being careful, but because there is nothing new to draw.
 *
 * Joints here are ROTATION ONLY, about a pivot, in a parent chain. That
 * is not a simplification waiting to be upgraded: it is what a flat
 * cut-out character can honestly do. Translating a part slides it out of
 * its socket and scaling it makes it a different animal, and both are
 * visible immediately in a way rotation is not.
 *
 * Everything is measured in SOURCE PIXELS and derived from the cut, so a
 * part's rest position is never typed in by hand. A part's box says where
 * it came from; its pivot says where in that box the joint is; the two
 * together give the rest position with no third number to disagree with
 * the first two.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Degrees, because a rig is authored by a person. Radians internally. */
const rad = (deg) => (deg * Math.PI) / 180

export function loadRig(dir, name) {
  const f = join(dir, name, 'rig.json')
  if (!existsSync(f)) {
    throw new Error(
      `No rig at ${f}.\n` +
        `Write canon/${name}/parts.json declaring the boxes and pivots, then:\n` +
        `  node run.mjs rig ${name}`,
    )
  }
  const rig = JSON.parse(readFileSync(f, 'utf8'))
  rig.dir = join(dir, name)
  return rig
}

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
  const state = new Map() // id -> 'open' | 'done'
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
 * centre lands on the new centre. Every other point follows from that,
 * and getting it wrong puts every limb a few pixels off its socket in a
 * way that reads as "the rig is loose" rather than as arithmetic.
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

/** Check a rig says enough to be rendered, before anything is rendered. */
export function checkRig(rig) {
  const problems = []
  if (!rig.canvas?.w || !rig.canvas?.h) problems.push('no canvas size')
  if (!rig.parts?.length) problems.push('no parts')
  const seen = new Set()
  for (const p of rig.parts || []) {
    if (seen.has(p.id)) problems.push(`two parts called "${p.id}"`)
    seen.add(p.id)
    if (!p.file) problems.push(`part "${p.id}" has no file`)
    if (!Array.isArray(p.at) || p.at.length !== 2) problems.push(`part "${p.id}" has no rest position`)
    if (!Array.isArray(p.pivotPx) || p.pivotPx.length !== 2) problems.push(`part "${p.id}" has no pivot`)
  }
  try {
    inOrder(rig)
  } catch (e) {
    problems.push(e.message)
  }
  return problems
}
