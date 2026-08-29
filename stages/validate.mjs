/**
 * VALIDATE - the code gates over every candidate, then the vision gates
 * over what survived.
 *
 * The order is the whole cost model. Code gates are free and
 * deterministic, so they run on everything, always, first; a candidate
 * with a gradient background is thrown out before any model is asked
 * whether it is beautiful. Vision costs money and takes seconds, so it is
 * spent only on candidates that have already earned it, and only on
 * questions code cannot answer - whether this is the same WORLD as the
 * reference, whether the character is on-model, whether the drawing
 * reads.
 *
 * Reports are files. A round leaves reports/round-N.json with every
 * number and reports/round-N.md to read, so "why was that one dropped"
 * has an answer six weeks later.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadBible, referencesFor } from '../lib/bible.mjs'
import { validateFile } from '../lib/validate.mjs'
import { askVision } from '../lib/gemini.mjs'
import { ensure, env } from '../lib/env.mjs'

const VISION_SCHEMA = {
  type: 'object',
  properties: {
    onStyle: { type: 'integer', description: '0-10, how completely this belongs to the same world as the reference images' },
    onModel: { type: 'integer', description: '0-10, how exactly the character or object matches the reference; 10 if no character is involved' },
    glow: { type: 'boolean', description: 'true if there is any glow, aura, bloom or light spill anywhere in the image' },
    drift: { type: 'string', description: 'the single most off-style thing about this image, in one short clause, or "none"' },
    readable: { type: 'integer', description: '0-10, how clearly the subject reads at thumbnail size' },
  },
  required: ['onStyle', 'onModel', 'glow', 'drift', 'readable'],
}

function visionPrompt(bible, asset) {
  return (
    `The first images are the reference: they define the world. The last image is a candidate.\n\n` +
    `The world is: ${bible.idiom}\n` +
    `Surfaces ${bible.texture}. Edges ${bible.edges}.\n` +
    (bible.bans?.length ? `It never has: ${bible.bans.join('; ')}.\n` : '') +
    `\nThe candidate was asked to be: ${asset.subject}${asset.action ? ', ' + asset.action : ''}\n\n` +
    `Score the candidate against the reference. Be hard: a 7 means "usable with a ` +
    `reservation", a 9 means "indistinguishable from the reference in style". Judge ` +
    `style and likeness only - not composition, not whether you like the subject.`
  )
}

export async function validate(dir, { vision = false, only, round, log = console.log } = {}) {
  const s = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8'))
  const bible = loadBible()
  const raw = join(dir, 'raw')
  const reports = ensure(join(dir, 'reports'))
  if (!existsSync(raw)) throw new Error('Nothing generated yet.')

  const n = round || nextRound(reports)
  const out = { round: n, vision, assets: [] }

  for (const a of s.assets) {
    if (only && !only.includes(a.id)) continue
    const files = readdirSync(raw).filter((f) => f.startsWith(a.id + '-')).sort()
    if (!files.length) continue
    const entry = { id: a.id, candidates: [] }
    for (const f of files) {
      const v = await validateFile(join(raw, f), a, bible)
      const c = { file: f, pass: v.pass, score: v.score, size: v.size, gates: v.results }
      entry.candidates.push(c)
      log(`  ${f.padEnd(24)} ${v.pass ? 'pass' : 'FAIL'}  ${v.score.toFixed(2)}`)
      for (const r of v.results) if (r.pass === false) log(`      X ${r.id}: ${r.detail}`)
    }
    // Vision only on survivors: paying a model to look at a candidate the
    // arithmetic already refused is paying for a second opinion on a
    // settled question.
    if (vision) {
      const refs = referencesFor(bible, a)
      // In parallel, but only two at a time by default. These calls are
      // independent and each takes the better part of a minute, so
      // running them one after another is twelve minutes for a round of
      // six assets. Four at once was measured and was too many: a free
      // tier's per-minute quota answered with 429s and the model itself
      // with 503s, which is slower than going slowly. Raise it with
      // STUDIO_VISION_CONCURRENCY on a paid key.
      const width = Number(env().STUDIO_VISION_CONCURRENCY || 2)
      await pool(entry.candidates.filter((x) => x.pass), width, async (c) => {
        try {
          const { answer, model } = await askVision({
            prompt: visionPrompt(bible, a),
            images: [...refs, join(raw, c.file)],
            schema: VISION_SCHEMA,
            kind: 'flash',
          })
          c.vision = { ...answer, model }
          const bad = answer.glow || answer.onStyle < (bible.visionFloor ?? 7) || answer.onModel < (bible.visionFloor ?? 7)
          if (bad) {
            c.pass = false
            c.visionFailed = true
          }
          log(
            `  ${c.file.padEnd(24)} vision style ${answer.onStyle} model ${answer.onModel} ` +
              `read ${answer.readable}${answer.glow ? ' GLOW' : ''}${bad ? '  -> dropped' : ''}` +
              (answer.drift && answer.drift !== 'none' ? `  (${answer.drift})` : ''),
          )
        } catch (e) {
          c.vision = { error: e.message }
          log(`  ${c.file.padEnd(24)} vision unavailable: ${e.message.split('\n')[0]}`)
        }
      })
    }
    entry.survivors = entry.candidates.filter((c) => c.pass).map((c) => c.file)
    out.assets.push(entry)
  }

  writeFileSync(join(reports, `round-${n}.json`), JSON.stringify(out, null, 2) + '\n')
  writeFileSync(join(reports, `round-${n}.md`), markdown(out))
  return out
}

/** Run `work` over `items`, at most `n` in flight. Small enough to write
    that a queue library would be a dependency to explain. */
async function pool(items, n, work) {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await work(queue.shift())
  })
  await Promise.all(runners)
}

function nextRound(reports) {
  const used = readdirSync(reports)
    .map((f) => /^round-(\d+)\.json$/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]))
  return (used.length ? Math.max(...used) : 0) + 1
}

function markdown(out) {
  const L = [`# Validation round ${out.round}`, '']
  for (const a of out.assets) {
    L.push(`## ${a.id}`, '')
    L.push(`${a.survivors.length} of ${a.candidates.length} candidates survived.`, '')
    for (const c of a.candidates) {
      L.push(`### ${c.file} - ${c.pass ? 'pass' : 'dropped'} (${c.score})`)
      for (const g of c.gates) {
        if (g.skipped) continue
        L.push(`- ${g.pass ? 'ok' : 'FAIL'} **${g.id}** - ${g.detail}`)
      }
      if (c.vision) {
        L.push(
          c.vision.error
            ? `- vision: unavailable (${c.vision.error.split('\n')[0]})`
            : `- vision: style ${c.vision.onStyle}, model ${c.vision.onModel}, readable ${c.vision.readable}` +
                `${c.vision.glow ? ', GLOW' : ''}${c.vision.drift && c.vision.drift !== 'none' ? ` - ${c.vision.drift}` : ''}`,
        )
      }
      L.push('')
    }
  }
  return L.join('\n')
}
