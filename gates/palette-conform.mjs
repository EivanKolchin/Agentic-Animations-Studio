/**
 * The subject's colours must be colours the bible names.
 */
import { oklab, toHex, srgb, paletteLab, nearest } from '../lib/colour.mjs'

export default {
  id: 'palette-conform',
  tier: 'code',
  what: 'every colour covering a meaningful share of the subject is near a bible colour',
  because:
    'Style drift does not arrive as one bad picture. It arrives as a fox whose orange ' +
    'is two per cent hotter than the last one, which nobody can see alone and everybody ' +
    'can see when the two sit in the same scene. A prompt assembled from the bible ' +
    'reduces it; only measurement catches it, because the model was never promising to ' +
    'obey a hex.',

  applies: (asset, bible) => !asset.offPalette && !!bible?.palette,

  async run({ small, mask, bible, cfg }) {
    const { erodeMask } = await import('../lib/mask.mjs')
    const pal = paletteLab(bible.palette)
    if (!pal.length) return { pass: true, score: 1, detail: 'bible declares no palette' }
    // Measure the INTERIOR. Every pixel on the silhouette is a blend of the
    // subject and the key, so it matches no palette entry by construction -
    // and on a small subject the rim is most of it, which had this gate
    // reporting the key's own hue as the subject's off-palette colour.
    const shave = Math.max(1, Math.round(Math.min(small.w, small.h) * cfg('shave', 0.006)))
    let core = mask
    for (let i = 0; i < shave; i++) core = erodeMask(core, small.w, small.h)
    let any = 0
    for (let i = 0; i < core.length; i++) any += core[i]
    if (!any) core = mask // a subject thinner than the shave is all rim; measure it anyway
    mask = core
    // Coarse OKLab histogram: 0.05 buckets are roughly "another colour",
    // which is the grain this question is asked at. Finer splits one
    // painted fill into a dozen shading steps and reports each separately.
    const S = cfg('bucket', 0.05)
    const bins = new Map()
    let n = 0
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue
      const p = i * 4
      const lab = oklab(small.data[p], small.data[p + 1], small.data[p + 2])
      const k = `${Math.round(lab[0] / S)},${Math.round(lab[1] / S)},${Math.round(lab[2] / S)}`
      const b = bins.get(k) || (bins.set(k, { n: 0, L: 0, a: 0, b: 0 }), bins.get(k))
      b.n++; b.L += lab[0]; b.a += lab[1]; b.b += lab[2]
      n++
    }
    if (!n) return { pass: false, score: 0, detail: 'no subject to measure' }
    const share = cfg('minShare', 0.02)
    const tol = cfg('tolerance', 0.1)
    const strays = []
    for (const b of bins.values()) {
      if (b.n / n < share) continue
      const lab = [b.L / b.n, b.a / b.n, b.b / b.n]
      const near = nearest(lab, pal)
      if (near.d > tol) strays.push({ hex: toHex(srgb(...lab)), share: b.n / n, d: near.d, near: near.name })
    }
    strays.sort((x, y) => y.share - x.share)
    const off = strays.reduce((s, x) => s + x.share, 0)
    const maxOff = cfg('maxOffPalette', 0.06)
    const pass = off <= maxOff
    return {
      pass,
      score: 1 - Math.min(1, off / Math.max(maxOff, 1e-6)),
      detail: strays.length
        ? `${(off * 100).toFixed(1)}% of the subject is off-palette (max ${(maxOff * 100).toFixed(0)}%): ` +
          strays.slice(0, 4).map((s) => `${s.hex} ${(s.share * 100).toFixed(1)}% (dE ${s.d.toFixed(2)} from ${s.near})`).join(', ')
        : 'every significant colour is on palette',
    }
  },
}
