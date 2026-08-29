/**
 * SPEC - turn an approved brief into per-asset instructions.
 *
 * The spec is the last point at which a human decides anything cheaply.
 * After it, every stage is mechanical: generation reads the assembled
 * prompt, the gates read the declarations, the cut reads the crop plan.
 * So this stage does three jobs and refuses to guess at any of them.
 *
 * It SCAFFOLDS: given a brief that lists assets, it writes a spec with a
 * slot per asset, so the shape is never typed from memory.
 * It ASSEMBLES: every prompt is built from the bible and written into the
 * spec, where it is diffable - a prompt that changed between rounds is
 * then a line in a diff rather than a difference nobody can find.
 * It CHECKS: the bible has to be complete, every asset has to have a
 * subject, and no asset is allowed a hand-written prompt.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadBible, checkBible, assemblePrompt } from '../lib/bible.mjs'
import { readBrief, requireApproved } from '../lib/brief.mjs'

export async function spec(dir, { candidates = 3 } = {}) {
  const brief = readBrief(dir)
  requireApproved(brief)
  const bible = loadBible()
  const problems = checkBible(bible)
  if (problems.length) throw new Error(`The bible is incomplete:\n  - ${problems.join('\n  - ')}`)

  const f = join(dir, 'spec.json')
  let s
  if (existsSync(f)) {
    s = JSON.parse(readFileSync(f, 'utf8'))
  } else {
    if (!brief.assets.length) {
      throw new Error(
        `${brief.file} lists no assets.\n` +
          'Add them under "## Assets" as "- id: what it is", then run spec again to\n' +
          'scaffold one entry each.',
      )
    }
    s = {
      _: 'Slots only. Prompts are assembled from the bible into "assembled" - never write one here.',
      candidates,
      assets: brief.assets.map((a) => ({
        id: a.id,
        subject: a.about,
        action: '',
        notes: '',
        key: bible.keyColour,
        aspect: '1:1',
        // Declarations the gates read. Present and false rather than absent,
        // so the author is asked the question rather than defaulted past it.
        bleed: false,
        allowHoles: false,
        offPalette: false,
        cut: { shrink: 2, width: 720 },
      })),
    }
  }

  s.candidates = s.candidates || candidates
  // Only the prompt is written back. The reference LIST is resolved at
  // generation time from the bible plus the asset's own additions: writing
  // the resolved list into the spec would merge the bible's references into
  // the asset's, and the next run would resolve them again on top.
  for (const a of s.assets) a.assembled = assemblePrompt(bible, a)
  writeFileSync(f, JSON.stringify(s, null, 2) + '\n')
  return { file: f, assets: s.assets.length, candidates: s.candidates }
}
