/**
 * Keying, despill and erosion - the cut, generalised to any key colour.
 *
 * The generator cannot produce transparency, so subjects arrive on a flat
 * key colour and the cut has to invent the alpha. The project this was
 * generalised from tested `min(R,B) - G`, which separates magenta from
 * everything in one subtraction and is worth admiring - and is worth
 * exactly nothing to a project whose key is bottle green. So the test
 * here is DISTANCE IN OKLAB from whatever colour the bible declares:
 * near the key is background, far from it is subject, and the soft band
 * between two thresholds is the antialiased edge.
 *
 * That one change also absorbs a special case the original needed. A pale
 * subject on charcoal keys by luminance; a DARK subject on charcoal does
 * not, and needed a second key that asked for saturation OR brightness.
 * In OKLab those are the same question - distance from a dark neutral IS
 * "brighter or more colourful" - so both cases are one metric with
 * different thresholds.
 */
import { oklab, srgb, hex, dE, chroma } from './colour.mjs'

/**
 * Sensible thresholds for a key colour, in OKLab distance.
 *
 * A chromatic key sits far from every subject colour, so it can afford a
 * wide band. A NEUTRAL key sits inside the same lightness range as dark
 * subjects, so its band has to be narrow - and above the JPEG chroma
 * noise in a flat dark field, which reaches about 0.02 and once left a
 * fog of specks that swallowed the trim box.
 */
export function defaultsFor(keyColour) {
  const lab = oklab(...hex(keyColour))
  return chroma(lab) > 0.08 ? { lo: 0.08, hi: 0.24 } : { lo: 0.04, hi: 0.1 }
}

/**
 * Key the background out, in place.
 *
 * Despill is the second half and cannot be skipped: an edge pixel that
 * survived still carries the key's cast, and on a JPEG source chroma
 * subsampling smears that cast several pixels in. It is removed by
 * projecting the pixel onto the key's own chroma direction and taking the
 * positive part back off - the general form of "cap red and blue at
 * green", which is what that subtraction meant for magenta. A key with no
 * chroma has no direction to remove, so a neutral key does not despill;
 * it erodes instead.
 */
export function keyOut(img, { keyColour, lo, hi, despill = true } = {}) {
  const key = oklab(...hex(keyColour))
  const d = defaultsFor(keyColour)
  const LO = lo ?? d.lo, HI = hi ?? d.hi
  const kc = chroma(key)
  const ux = kc > 1e-6 ? key[1] / kc : 0
  const uy = kc > 1e-6 ? key[2] / kc : 0
  const spillRange = HI * 1.6 // how far the cast reaches past the edge
  const px = img.data
  for (let i = 0; i < img.w * img.h; i++) {
    const p = i * 4
    const lab = oklab(px[p], px[p + 1], px[p + 2])
    const dist = dE(lab, key)
    const a = dist <= LO ? 0 : dist >= HI ? 1 : (dist - LO) / (HI - LO)
    px[p + 3] = Math.round(a * 255)
    if (a > 0 && despill && kc > 0.02 && dist < spillRange) {
      // Projection onto the key's hue direction, relative to the key's own
      // position: only the part of this pixel that is leaning TOWARD the
      // key is contamination.
      const proj = (lab[1] - key[1]) * ux + (lab[2] - key[2]) * uy
      if (proj > -kc) {
        const strength = 1 - dist / spillRange
        const cut = Math.min(proj + kc, kc) * strength
        const out = srgb(lab[0], lab[1] - cut * ux, lab[2] - cut * uy)
        px[p] = out[0]; px[p + 1] = out[1]; px[p + 2] = out[2]
      }
    }
  }
  return img
}

/**
 * Shrink the alpha mask by r pixels - a separable min filter.
 *
 * JPEG ringing leaves pixels that are visibly tinted yet score too far
 * from the key to be removed, which is exactly the pink thread that
 * appears along a ridge line. Eating the boundary is the honest fix:
 * those pixels are half background anyway. It is NOT free - a subject
 * drawn as single-pixel filaments (pappus, hair, whiskers) is deleted by
 * one round of it, so thin subjects take shrink: 0 and rely on the key.
 */
export function erode(img, r) {
  if (!r) return img
  const { w, h, data } = img
  const a = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) a[i] = data[i * 4 + 3]
  const tmp = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255
      for (let d = -r; d <= r; d++) {
        const xx = x + d
        m = Math.min(m, xx < 0 || xx >= w ? 0 : a[y * w + xx])
      }
      tmp[y * w + x] = m
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255
      for (let d = -r; d <= r; d++) {
        const yy = y + d
        m = Math.min(m, yy < 0 || yy >= h ? 0 : tmp[yy * w + x])
      }
      data[(y * w + x) * 4 + 3] = m
    }
  }
  return img
}

/**
 * The distance-to-key of every pixel, downscaled - the measurement every
 * gate that asks about the background is really asking for.
 */
export function distanceField(img, keyColour) {
  const key = oklab(...hex(keyColour))
  const out = new Float32Array(img.w * img.h)
  for (let i = 0; i < img.w * img.h; i++) {
    const p = i * 4
    out[i] = dE(oklab(img.data[p], img.data[p + 1], img.data[p + 2]), key)
  }
  return out
}
