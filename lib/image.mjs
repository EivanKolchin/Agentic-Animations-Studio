/**
 * Pixels in and pixels out. Everything above this file works on one plain
 * shape - { data: RGBA bytes, w, h } - so gates, keying and sheets never
 * hold a sharp pipeline and never have to think about decode order.
 *
 * sharp's cache and concurrency are turned down for the same reason the
 * project this came from turned them down: these are batch runs over
 * dozens of large sources, and libvips' operation cache holds every
 * intermediate until the run dies of it.
 */
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'

sharp.cache(false)
sharp.concurrency(1)

/** Decode to RGBA. Always four channels, so no caller branches on alpha. */
export async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

/** Wrap raw bytes back into a sharp pipeline. */
export function pipe(img) {
  return sharp(Buffer.from(img.data), { raw: { width: img.w, height: img.h, channels: 4 } })
}

export async function save(img, file, { width, quality = 86, format } = {}) {
  let p = pipe(img)
  if (width) p = p.resize({ width, withoutEnlargement: true })
  const fmt = format || (file.endsWith('.webp') ? 'webp' : 'png')
  p = fmt === 'webp' ? p.webp({ quality, effort: 6 }) : p.png({ compressionLevel: 9 })
  const { data, info } = await p.toBuffer({ resolveWithObject: true })
  writeFileSync(file, data)
  return { w: info.width, h: info.height, kb: +(data.length / 1024).toFixed(1) }
}

/** A rectangle of an image, as its own image. */
export function crop(img, { left, top, width, height }) {
  const l = Math.max(0, left | 0), t = Math.max(0, top | 0)
  const w = Math.min(width | 0, img.w - l), h = Math.min(height | 0, img.h - t)
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    img.data.copy(out, y * w * 4, ((t + y) * img.w + l) * 4, ((t + y) * img.w + l + w) * 4)
  }
  return { data: out, w, h }
}

/**
 * Box-average down to at most `maxDim` on the long side.
 *
 * Every gate that asks a question about colour asks it of this, not of
 * the original: a validator reading four million pixels to answer "is the
 * background flat" is paying twenty times over for an answer that does
 * not change. Averaging also kills the JPEG chroma noise that made the
 * first version of the neutral key keep a fog of specks.
 */
export function downscale(img, maxDim = 512) {
  const f = Math.max(1, Math.ceil(Math.max(img.w, img.h) / maxDim))
  if (f === 1) return img
  const w = Math.max(1, Math.floor(img.w / f)), h = Math.max(1, Math.floor(img.h / f))
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let dy = 0; dy < f; dy++) {
        const sy = y * f + dy
        if (sy >= img.h) break
        for (let dx = 0; dx < f; dx++) {
          const sx = x * f + dx
          if (sx >= img.w) break
          const p = (sy * img.w + sx) * 4
          r += img.data[p]; g += img.data[p + 1]; b += img.data[p + 2]; a += img.data[p + 3]; n++
        }
      }
      const p = (y * w + x) * 4
      out[p] = r / n; out[p + 1] = g / n; out[p + 2] = b / n; out[p + 3] = a / n
    }
  }
  return { data: out, w, h }
}

/** Bounding box of everything at least `t` opaque, or null if nothing is. */
export function bbox(img, t = 128) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] >= t) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/** Fraction of pixels at least half opaque. */
export function coverage(img) {
  let n = 0
  for (let i = 0; i < img.w * img.h; i++) if (img.data[i * 4 + 3] >= 128) n++
  return n / (img.w * img.h)
}

/**
 * Where the topmost opaque row sits, as a fraction of width.
 *
 * This is an ANCHOR, and anchors are why sheets can be cut mechanically:
 * a stem's tip, a character's crown, the point a later stage has to hang
 * something else off. Measured rather than eyeballed, it survives the art
 * being redrawn.
 */
export function topAnchor(img) {
  for (let y = 0; y < img.h; y++) {
    let first = -1, last = -1
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] > 128) {
        if (first < 0) first = x
        last = x
      }
    }
    if (first >= 0) return +(((first + last) / 2 / img.w).toFixed(4))
  }
  return 0.5
}

export async function meta(file) {
  const m = await sharp(file).metadata()
  return { w: m.width, h: m.height, format: m.format }
}
