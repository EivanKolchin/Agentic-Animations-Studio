/**
 * The still has to be honest about the motion.
 */
export default {
  id: 'motion-still-honesty',
  tier: 'motion',
  what: 'the frame at t=0 sits near the middle of every part\'s travel, not at an extreme',
  because:
    'Something always shows a single frame of this: a poster, a thumbnail, a lazy-load ' +
    'placeholder, a player that captures a still and swaps the live version in. Whatever ' +
    'renders at t=0 is the picture most people see most often, and a sine starts at zero ' +
    'while a cosine starts at its maximum - so a phase typed without thinking puts the ' +
    'character permanently at the top of its swing, tail flung out, head at full turn. It ' +
    'looks like a mistake in the drawing rather than a moment in the motion, and it is ' +
    'invisible while the animation is playing, which is the only way anybody ever looks ' +
    'at it.',

  applies: () => true,

  async run({ clip, poseAt, cfg }) {
    const span = clip.period ?? 4
    const N = 240
    const range = new Map()
    for (let i = 0; i <= N; i++) {
      const pose = poseAt(clip, (i * span) / N)
      for (const [id, v] of Object.entries(pose)) {
        const r = range.get(id) || { lo: Infinity, hi: -Infinity }
        r.lo = Math.min(r.lo, v)
        r.hi = Math.max(r.hi, v)
        range.set(id, r)
      }
    }
    const start = poseAt(clip, 0)
    const limit = cfg('maxExtreme', 0.6)
    const loud = []
    for (const [id, r] of range) {
      const half = (r.hi - r.lo) / 2
      // A part that barely moves has no meaningful middle, and demanding
      // one would fail every deliberately still part in the rig.
      if (half < cfg('minTravel', 0.5)) continue
      const off = Math.abs((start[id] ?? 0) - (r.lo + half)) / half
      if (off > limit) loud.push(`${id} starts at ${(off * 100).toFixed(0)}% of its travel`)
    }
    return {
      pass: !loud.length,
      score: loud.length ? 0 : 1,
      detail: loud.length
        ? `${loud.join(', ')} (max ${(limit * 100).toFixed(0)}%) - shift the phase so the still frame is a resting pose`
        : `every moving part starts near the middle of its travel`,
    }
  },
}
