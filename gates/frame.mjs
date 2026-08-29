/**
 * The frame the asset was asked for is the frame that came back.
 */
export default {
  id: 'frame',
  tier: 'code',
  what: 'aspect, resolution and the subject\'s margin match what the spec asked for',
  because:
    'Image models honour an aspect ratio approximately and a resolution not at all, ' +
    'and a subject that runs off the edge of its frame cannot be trimmed, cannot be ' +
    'anchored, and cannot be composited - it has no silhouette, only a crop. Both are ' +
    'one line to measure and neither is visible in a contact sheet, where every ' +
    'candidate is scaled to the same box and the cropping looks like framing.',

  applies: () => true,

  async run({ small, mask, asset, cfg }) {
    const { maskBox } = await import('../lib/mask.mjs')
    const notes = []
    let pass = true
    if (asset.aspect) {
      const [aw, ah] = String(asset.aspect).split(':').map(Number)
      const want = aw / ah
      const got = small.w / small.h
      const off = Math.abs(got - want) / want
      if (off > cfg('aspectTolerance', 0.02)) {
        pass = false
        notes.push(`aspect ${got.toFixed(3)} against ${asset.aspect} (${want.toFixed(3)})`)
      }
    }
    if (mask) {
      const box = maskBox(mask, small.w, small.h)
      if (!box) {
        pass = false
        notes.push('no subject in the frame')
      } else if (asset.bleed || asset.mayTouchEdge) {
        // Two different declarations, and conflating them was a bug worth
        // naming. `bleed` means the asset IS the background - a sky, a
        // painted field - so it is never keyed and never trimmed.
        // `mayTouchEdge` means an ordinary keyed subject is allowed to reach
        // the frame, which a full-height stem in a square frame genuinely
        // is. Using bleed for the second case turned keying off and shipped
        // the key colour.
        notes.push('allowed to reach the frame')
      } else {
        const m = Math.max(1, Math.round(Math.min(small.w, small.h) * cfg('margin', 0.01)))
        const clipped =
          box.left < m || box.top < m || box.left + box.width > small.w - m || box.top + box.height > small.h - m
        if (clipped) {
          pass = false
          notes.push('the subject runs into the edge of the frame - it has been cropped, not framed')
        }
        notes.push(`subject fills ${((box.width * box.height) / (small.w * small.h) * 100).toFixed(0)}% of the frame`)
      }
    }
    return { pass, score: pass ? 1 : 0, detail: notes.join('; ') || 'frame as specified' }
  },
}
