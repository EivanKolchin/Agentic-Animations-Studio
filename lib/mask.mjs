/**
 * Masks: the shapes gates reason about.
 *
 * Everything here works on a Uint8Array of 0/1 the size of the image, and
 * everything here is O(pixels) with no allocation per pixel, because these
 * run over every candidate of every asset of every round.
 */

/** Subject mask from a keyed image: 1 where the pixel survived. */
export function subjectMask(img, t = 128) {
  const m = new Uint8Array(img.w * img.h)
  for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] >= t ? 1 : 0
  return m
}

/**
 * Everything reachable from the border through zeros - the OUTSIDE.
 *
 * The complement of this, among the zeros, is holes: background colour
 * that the subject has closed around. That distinction is the whole of
 * the key-collision gate, and it cannot be made by counting pixels.
 */
export function outside(mask, w, h) {
  const out = new Uint8Array(w * h)
  const stack = []
  const push = (i) => {
    if (!mask[i] && !out[i]) { out[i] = 1; stack.push(i) }
  }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (stack.length) {
    const i = stack.pop()
    const x = i % w, y = (i / w) | 0
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (y > 0) push(i - w)
    if (y < h - 1) push(i + w)
  }
  return out
}

/** One round of 4-neighbour dilation. */
export function dilate(mask, w, h) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      out[i] =
        mask[i] ||
        (x > 0 && mask[i - 1]) ||
        (x < w - 1 && mask[i + 1]) ||
        (y > 0 && mask[i - w]) ||
        (y < h - 1 && mask[i + w])
          ? 1
          : 0
    }
  }
  return out
}

/** One round of 4-neighbour erosion - dilation's mirror. Anything on the
    boundary goes, which is exactly what a caller wants when the boundary
    pixels are blends rather than colours anyone chose. */
export function erodeMask(mask, w, h) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      out[i] =
        mask[i] &&
        x > 0 && mask[i - 1] &&
        x < w - 1 && mask[i + 1] &&
        y > 0 && mask[i - w] &&
        y < h - 1 && mask[i + w]
          ? 1
          : 0
    }
  }
  return out
}

/** Count of 1s. */
export const area = (m) => m.reduce((s, v) => s + v, 0)

/** Bounding box of a mask, or null. */
export function maskBox(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/**
 * Connected components of a mask, largest first, as { area, box }.
 * Iterative on purpose - a recursive flood fill blows the stack on a
 * two-megapixel subject, which is the size every one of these is.
 */
export function components(mask, w, h, minArea = 1) {
  const seen = new Uint8Array(w * h)
  const found = []
  const stack = []
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue
    stack.length = 0
    stack.push(s)
    seen[s] = 1
    let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1
    while (stack.length) {
      const i = stack.pop()
      const x = i % w, y = (i / w) | 0
      n++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
      for (const j of nb) if (j >= 0 && mask[j] && !seen[j]) { seen[j] = 1; stack.push(j) }
    }
    if (n >= minArea) found.push({ area: n, box: { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } })
  }
  return found.sort((a, b) => b.area - a.area)
}
