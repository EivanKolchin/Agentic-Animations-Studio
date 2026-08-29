/**
 * GENERATE - N candidates per asset, references attached, spend counted.
 *
 * CANDIDATES, NOT RETRIES. A conversational re-roll is one picture, a
 * judgement, and a round trip through a human; three candidates cost the
 * same credits, arrive together, and let the choice be made by comparison
 * - which is the only way anybody has ever chosen between pictures. The
 * bad ones are kept too: raw/ is never pruned, so a selection can be
 * argued with later and a gate written next month can be run over what
 * was rejected last month.
 *
 * Nothing is regenerated that already exists. Resuming a production is
 * the normal case, not the exception, and a stage that redoes finished
 * work makes resuming cost money.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadBible, referencesFor } from '../lib/bible.mjs'
import { readBrief, requireApproved } from '../lib/brief.mjs'
import { generateImage, pickModel } from '../lib/gemini.mjs'
import { ledger } from '../lib/ledger.mjs'
import { ensure } from '../lib/env.mjs'

const pad = (n) => String(n).padStart(2, '0')

export async function generate(dir, { only, n, force = false, log = console.log } = {}) {
  const brief = readBrief(dir)
  requireApproved(brief)
  const specFile = join(dir, 'spec.json')
  if (!existsSync(specFile)) throw new Error('No spec.json yet. Run: node run.mjs spec <production>')
  const s = JSON.parse(readFileSync(specFile, 'utf8'))
  const bible = loadBible()
  const raw = ensure(join(dir, 'raw'))
  const book = ledger(dir)
  const model = await pickModel('image')
  log(`image model: ${model}`)

  const assets = s.assets.filter((a) => !only || only.includes(a.id))
  if (!assets.length) throw new Error(`No asset matching ${JSON.stringify(only)} in the spec.`)
  const want = n || s.candidates || 3
  const made = []

  for (const a of assets) {
    if (!a.assembled) throw new Error(`Asset "${a.id}" has no assembled prompt. Run the spec stage first.`)
    const have = readdirSync(raw).filter((f) => f.startsWith(a.id + '-') && f.endsWith('.png')).length
    const refs = referencesFor(bible, a)
    for (const r of refs) {
      if (!existsSync(r)) throw new Error(`Reference image missing: ${r}`)
    }
    for (let i = have; i < want; i++) {
      book.check(1, { force, briefCap: brief.cap })
      const { buffer, usage } = await generateImage({ prompt: a.assembled, refs, model })
      const file = join(raw, `${a.id}-${pad(i + 1)}.png`)
      writeFileSync(file, buffer)
      const spent = book.record({ asset: a.id, model, forced: force, usage })
      made.push(file)
      log(`  ${a.id}-${pad(i + 1)}  ${(buffer.length / 1024).toFixed(0)} KB   (${spent}/${book.cap(brief.cap)} of the cap)`)
    }
    if (have >= want) log(`  ${a.id}: ${have} candidates already on disk, nothing to do`)
  }
  return { made, spent: book.read().spent, cap: book.cap(brief.cap), refs: referencesFor(bible, assets[0]).length }
}
