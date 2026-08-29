/**
 * VALIDATE MOTION - the gates that need time to run.
 *
 * Same registry and same provenance rule as the picture gates; a
 * different tier, because what they are handed is a rig and a clip rather
 * than a candidate and a mask. Keeping one registry is the point: a gate
 * is a gate, it declares the failure that created it, and nobody has to
 * remember which of two lists a new one belongs on.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gates, config } from '../gates/index.mjs'
import { loadRig, solve } from '../lib/rig.mjs'
import { poseAt } from '../lib/motion.mjs'
import { renderPose } from '../lib/render.mjs'
import { CANON, ensure } from '../lib/env.mjs'

export async function checkMotion(rigName, { clip: only, log = console.log } = {}) {
  const rig = loadRig(CANON, rigName)
  const clips = Object.entries(rig.clips || {}).filter(([n]) => !only || n === only)
  if (!clips.length) throw new Error(`${rigName} has no clip${only ? ` called "${only}"` : 's'} to check.`)
  const loaded = await gates()
  const all = loaded.filter((g) => g.tier === 'motion')
  const out = { rig: rigName, rig_gates: [], clips: [] }

  // Rig-tier gates ask about the DECOMPOSITION, not about a clip, so they
  // run once. Running them per clip would report the same answer as many
  // times as there are clips and cost a render each time.
  for (const g of loaded.filter((x) => x.tier === 'rig')) {
    let r
    try {
      r = await g.run({ rig, poseAt, solve, renderPose, cfg: config(null, rig, g.id) })
    } catch (e) {
      r = { pass: false, score: 0, detail: `gate errored: ${e.message}` }
    }
    out.rig_gates.push({ id: g.id, ...r })
    log(`  ${r.pass ? ' ' : 'X'} ${g.id.padEnd(22)} ${r.detail}`)
  }

  for (const [name, clip] of clips) {
    log(`  ${name}`)
    const entry = { clip: name, results: [] }
    for (const g of all) {
      if (g.applies && !g.applies(clip, rig)) {
        entry.results.push({ id: g.id, skipped: true, detail: 'does not apply to this clip' })
        continue
      }
      let r
      try {
        r = await g.run({ rig, clip, clipName: name, poseAt, solve, renderPose, cfg: config(null, clip, g.id) })
      } catch (e) {
        r = { pass: false, score: 0, detail: `gate errored: ${e.message}` }
      }
      entry.results.push({ id: g.id, ...r })
      log(`    ${r.pass ? ' ' : 'X'} ${g.id.padEnd(22)} ${r.detail}`)
    }
    entry.pass = !entry.results.some((r) => r.pass === false)
    out.clips.push(entry)
  }

  const file = join(ensure(join(rig.dir, 'reports')), 'motion.json')
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
  out.pass = out.clips.every((c) => c.pass) && out.rig_gates.every((r) => r.pass !== false)
  return out
}
