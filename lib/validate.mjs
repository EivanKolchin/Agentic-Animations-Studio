/**
 * Run the code gates over one candidate.
 *
 * The measurement is done ONCE and shared: decode, downscale, distance to
 * the key, subject mask. Six gates each re-deriving those from the file
 * would be six decodes of a four-megapixel JPEG per candidate, and there
 * are dozens of candidates per round.
 *
 * Downscaling before measuring is not a shortcut either - it is the right
 * scale for the question. Every gate here asks about REGIONS: is the
 * border flat, does the subject enclose the key, how far does a halo
 * reach. At full resolution those answers are the same answer plus JPEG
 * noise, and it was that noise which produced the first false failures.
 */
import { load, downscale } from './image.mjs'
import { distanceField, defaultsFor } from './key.mjs'
import { subjectMask } from './mask.mjs'
import { gates, config } from '../gates/index.mjs'

export async function measure(file, asset, bible, { scale = 512 } = {}) {
  const full = await load(file)
  const small = downscale(full, scale)
  const key = asset.key || null
  let dist = null, mask = null, lo = null, hi = null
  if (key) {
    const d = defaultsFor(key)
    lo = asset.keyLo ?? bible?.keyLo ?? d.lo
    hi = asset.keyHi ?? bible?.keyHi ?? d.hi
    dist = distanceField(small, key)
    const half = lo + (hi - lo) / 2
    mask = new Uint8Array(small.w * small.h)
    for (let i = 0; i < mask.length; i++) mask[i] = dist[i] >= half ? 1 : 0
  } else {
    mask = subjectMask(full.w === small.w ? full : small, 128)
  }
  return { file, full: { w: full.w, h: full.h }, small, key, dist, mask, lo, hi, asset, bible }
}

/** Every applicable code gate, in order, over one candidate. */
export async function runCodeGates(ctx) {
  const all = await gates()
  const results = []
  for (const g of all) {
    if (g.tier !== 'code') continue
    if (g.applies && !g.applies(ctx.asset, ctx.bible)) {
      results.push({ id: g.id, skipped: true, detail: 'does not apply to this asset' })
      continue
    }
    try {
      const r = await g.run({ ...ctx, cfg: config(ctx.bible, ctx.asset, g.id) })
      results.push({ id: g.id, ...r })
    } catch (e) {
      // A gate that throws is a broken gate, and a broken gate must not
      // quietly pass a candidate it never looked at.
      results.push({ id: g.id, pass: false, score: 0, detail: `gate errored: ${e.message}` })
    }
  }
  return results
}

export async function validateFile(file, asset, bible, opts) {
  const ctx = await measure(file, asset, bible, opts)
  const results = await runCodeGates(ctx)
  const failed = results.filter((r) => r.pass === false)
  return {
    file,
    pass: failed.length === 0,
    score: +(
      results.filter((r) => !r.skipped).reduce((s, r) => s + (r.score ?? (r.pass ? 1 : 0)), 0) /
      Math.max(1, results.filter((r) => !r.skipped).length)
    ).toFixed(3),
    results,
    size: ctx.full,
  }
}
