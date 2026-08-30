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

// The maths lives in pose.mjs, which imports nothing, because the browser
// gets shipped that exact file. Re-exported here so every existing caller
// is unaffected and there is one implementation of a bend chain rather
// than two that agree until one is fixed.
export { inOrder, solve, rotatedPivot, transformOf } from './pose.mjs'
import { inOrder } from './pose.mjs'

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
