/**
 * Colour, in the one space that lets every other file stop guessing.
 *
 * Everything here works in OKLab. That is not a fashion: keying, palette
 * conformance and despill are all questions about how FAR APART two
 * colours look, and sRGB answers that question wrongly - the same numeric
 * step is a different visual step in green than in blue. In OKLab a
 * distance is a distance, so one threshold means the same thing whatever
 * hue the project's bible happens to use.
 *
 * That is what makes the engine style-agnostic. The keying code in the
 * project this was generalised from tested `min(R,B) - G`, which is a
 * beautiful trick and only works because the key was magenta. Here the
 * key can be any colour and the metric does not change.
 */

/** '#rrggbb' or '#rgb' to [r,g,b] 0-255. Throws loudly: a mistyped hex in
    a bible would otherwise silently become black and pass every gate. */
export function hex(s) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s).trim())
  if (!m) throw new Error(`Not a hex colour: ${JSON.stringify(s)}`)
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function toHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return '#' + c(r) + c(g) + c(b)
}

const lin = (c) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const unlin = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

/** sRGB 0-255 to OKLab. Ottosson's matrices, unmodified. */
export function oklab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab back to sRGB 0-255, clamped. */
export function srgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    unlin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ].map((v) => Math.max(0, Math.min(255, v)))
}

/** Straight Euclidean distance in OKLab: ~0.02 is a just-noticeable
    difference, ~0.1 is clearly another colour, ~0.4 is unrelated. */
export function dE(a, b) {
  const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2]
  return Math.sqrt(dl * dl + da * da + db * db)
}

/** Chroma of an OKLab triple - how far it is from the grey axis. */
export const chroma = ([, a, b]) => Math.hypot(a, b)

/** Nearest entry of a palette (name to hex map) plus the distance to it. */
export function nearest(lab, paletteLab) {
  let best = null, bestD = Infinity
  for (const [name, p] of paletteLab) {
    const d = dE(lab, p)
    if (d < bestD) { bestD = d; best = name }
  }
  return { name: best, d: bestD }
}

/** A palette object ({role: '#hex'}) as [name, oklab] pairs, ready to
    measure against. Keys starting with _ are comments, not colours. */
export function paletteLab(palette) {
  return Object.entries(palette)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => [k, oklab(...hex(v))])
}
