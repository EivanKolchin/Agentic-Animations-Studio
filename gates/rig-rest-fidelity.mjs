/**
 * A rig at rest must be the canon, pixel for pixel.
 */
export default {
  id: 'rig-rest-fidelity',
  tier: 'rig',
  what: 'the rig rendered in its rest pose reproduces the source it was cut from',
  because:
    'A rig is a decomposition, and a decomposition can be wrong in two directions that ' +
    'no other check sees. It can LOSE pixels - a box measured a fraction short, a limb ' +
    'nobody declared - and the loss is invisible at rest because the missing sliver is ' +
    'where two parts met anyway. It can also INVENT them, by cutting the same pixels into ' +
    'two parts that then both draw. Either way the rig looks right standing still and ' +
    'comes apart the moment anything rotates, which reads as bad art rather than as bad ' +
    'arithmetic, and gets chased in the wrong place for an hour.\n\n' +
    'It was found as a hand-written probe while diagnosing a tail that looked wrong in a ' +
    'strip. The tail was fine. Nothing was going to run that probe again, so it is a gate.',

  applies: () => true,

  async run({ rig, renderPose, cfg }) {
    const sharp = (await import('sharp')).default
    const { join } = await import('node:path')
    const rest = await renderPose(rig, {})
    const [src, got] = await Promise.all([
      sharp(join(rig.dir, rig.source)).ensureAlpha().raw().toBuffer(),
      sharp(rest).ensureAlpha().raw().toBuffer(),
    ])
    const n = rig.canvas.w * rig.canvas.h
    let missing = 0, extra = 0, subject = 0
    for (let i = 0; i < n; i++) {
      const a = src[i * 4 + 3] >= 128
      const b = got[i * 4 + 3] >= 128
      if (a) subject++
      if (a && !b) missing++
      else if (!a && b) extra++
    }
    if (!subject) return { pass: false, score: 0, detail: 'the source has no subject in it' }
    const lost = missing / subject
    const gained = extra / subject
    // The tolerance is for ANTIALIASING at box edges, and nothing else: a
    // part boundary cuts through half-transparent pixels and the two
    // halves do not recombine to exactly what they were. A real defect is
    // a limb or a slice of one, which is orders of magnitude bigger.
    const max = cfg('maxDrift', 0.01)
    const pass = lost <= max && gained <= max
    return {
      pass,
      score: 1 - Math.min(1, Math.max(lost, gained) / max),
      detail: pass
        ? `rest pose matches the canon: ${(lost * 100).toFixed(2)}% lost, ${(gained * 100).toFixed(2)}% invented`
        : `${(lost * 100).toFixed(2)}% of the subject is LOST and ${(gained * 100).toFixed(2)}% INVENTED at rest ` +
          `(max ${(max * 100).toFixed(1)}% either way). A box is short, a part is undeclared, or two parts ` +
          `are drawing the same pixels.`,
    }
  },
}
