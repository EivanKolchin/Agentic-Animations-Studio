/**
 * Nothing glows.
 */
export default {
  id: 'edge-halo',
  tier: 'code',
  what: 'the background returns to the key colour within a few pixels of the silhouette',
  because:
    'Ask any image model for a subject on a flat field and it will light the field ' +
    'behind the subject, because that is what most of the pictures it learned from do. ' +
    'The halo is faint, it reads as "nicely lit" in the candidate, and it is fatal: ' +
    'keying turns a soft luminance ramp into a semi-transparent skirt welded to the ' +
    'sprite, visible over every background except the one it was generated on. Banning ' +
    'glow in the prompt is not enforcement. This is: contamination is measured as a ' +
    'function of distance from the silhouette, and a clean cut has none two pixels out.',

  applies: (asset) => !!asset.key,

  async run({ small, mask, dist, lo, cfg }) {
    const { dilate } = await import('../lib/mask.mjs')
    const { w, h } = small
    const reach = Math.max(4, Math.round(Math.min(w, h) * cfg('reach', 0.03)))
    let prev = mask
    const bands = []
    for (let r = 1; r <= reach; r++) {
      const next = dilate(prev, w, h)
      let n = 0, sum = 0
      for (let i = 0; i < next.length; i++) {
        if (next[i] && !prev[i]) { n++; sum += dist[i] }
      }
      bands.push(n ? sum / n : 0)
      prev = next
    }
    // Where the contamination has decayed to the keying floor, and the
    // floor is `lo` itself rather than something above it - lo is exactly
    // the line keying draws, so a pixel under it is erased and harmless
    // while a pixel over it survives into the sprite. Anything softer than
    // that misses a real halo: the first version allowed a fifth more and
    // let a glow whose whole profile sat between the two thresholds pass,
    // which is the faint case worth catching, because the strong one is
    // visible to anybody.
    const floor = lo * cfg('floorFactor', 1)
    let settle = bands.findIndex((v) => v <= floor)
    if (settle < 0) settle = reach
    const maxPx = Math.max(2, Math.round(Math.min(w, h) * cfg('maxHalo', 0.008)))
    const pass = settle <= maxPx
    return {
      pass,
      score: 1 - Math.min(1, settle / Math.max(maxPx, 1)),
      detail:
        `contamination settles ${settle}px out (max ${maxPx}px at this scale); ` +
        `profile ${bands.slice(0, 8).map((v) => v.toFixed(2)).join(' ')}`,
    }
  },
}
