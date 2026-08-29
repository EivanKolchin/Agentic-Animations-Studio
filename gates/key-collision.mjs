/**
 * The subject must not wear the key colour.
 */
export default {
  id: 'key-collision',
  tier: 'code',
  what: 'no part of the subject is close enough to the key colour to be cut out with it',
  because:
    'A key colour is chosen to be far from every colour the world may use, and then ' +
    'a generation puts a magenta flower in the fox\'s mouth, or a charcoal shadow ' +
    'under a pale subject on a charcoal key. Keying then punches holes THROUGH the ' +
    'subject. Counting background pixels cannot see this - the count is right, the ' +
    'pixels are just in the wrong place - so it is measured as holes: background ' +
    'colour the subject has closed around, which a correct cut never contains.',

  applies: (asset) => !!asset.key,

  async run({ small, mask, asset, cfg }) {
    const { outside, components } = await import('../lib/mask.mjs')
    const { w, h } = small
    const out = outside(mask, w, h)
    const holes = new Uint8Array(w * h)
    let subject = 0
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) subject++
      else if (!out[i]) holes[i] = 1
    }
    if (!subject) return { pass: false, score: 0, detail: 'nothing survived the key - the frame is all background' }
    // A hole worth failing over is a hole you can see: single specks are
    // JPEG noise inside a flat fill and are closed by one erosion.
    const minHole = Math.max(4, Math.round(subject * cfg('minHole', 0.0004)))
    const real = components(holes, w, h, minHole)
    const holeArea = real.reduce((s, c) => s + c.area, 0)
    const frac = holeArea / subject
    const max = cfg('maxHoleFraction', 0.01)
    // Read off the asset, like bleed and keyEdges: the declarations an
    // author makes about the SUBJECT belong next to the subject, and
    // gates: {} is for moving a threshold, not for stating a fact.
    const allowed = asset.allowHoles === true
    const pass = allowed || frac <= max
    return {
      pass,
      score: 1 - Math.min(1, frac / Math.max(max, 1e-6)),
      detail: real.length
        ? `${real.length} hole(s) in the subject, ${(frac * 100).toFixed(2)}% of it ` +
          `(max ${(max * 100).toFixed(2)}%${allowed ? ', waived by allowHoles' : ''}), ` +
          `largest at ${JSON.stringify(real[0].box)}`
        : 'no key colour inside the subject',
    }
  },
}
