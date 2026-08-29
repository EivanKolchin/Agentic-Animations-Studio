/**
 * What is planted stays planted.
 */
export default {
  id: 'motion-anchor-drift',
  tier: 'motion',
  what: 'parts declared planted do not travel across the clip',
  because:
    'A rig turns a body and everything hanging off it comes along, which is what a parent ' +
    'chain is for and is exactly wrong for the parts touching the ground. Sway the body ' +
    'two degrees and the paws slide, and the character is skating - a defect nobody can ' +
    'name from a still and everybody feels in motion, usually described as "it looks ' +
    'floaty". The fix is always to re-parent or to move a pivot, never to make the motion ' +
    'smaller, so it has to be caught as a measurement in pixels rather than as a note ' +
    'about how it feels.',

  applies: (clip) => !!(clip.planted || []).length,

  async run({ rig, clip, poseAt, solve, cfg }) {
    const span = clip.period ?? 4
    const N = 120
    const first = new Map()
    const worst = new Map()
    for (let i = 0; i <= N; i++) {
      const solved = new Map(solve(rig, poseAt(clip, (i * span) / N)).map((s) => [s.id, s]))
      for (const id of clip.planted) {
        const s = solved.get(id)
        if (!s) return { pass: false, score: 0, detail: `"${id}" is declared planted but is not a part of this rig` }
        if (!first.has(id)) first.set(id, s.pivot)
        const [x0, y0] = first.get(id)
        const d = Math.hypot(s.pivot[0] - x0, s.pivot[1] - y0)
        worst.set(id, Math.max(worst.get(id) || 0, d))
      }
    }
    const max = cfg('maxDrift', 1.5)
    const slipping = [...worst].filter(([, d]) => d > max)
    return {
      pass: !slipping.length,
      score: slipping.length ? 0 : 1,
      detail: slipping.length
        ? slipping.map(([id, d]) => `${id} slides ${d.toFixed(1)}px (max ${max})`).join(', ') +
          ' - re-parent it or move its pivot; making the motion smaller only hides it'
        : `${[...worst].map(([id, d]) => `${id} ${d.toFixed(2)}px`).join(', ')} - planted`,
    }
  },
}
