/**
 * The gate registry.
 *
 * A gate is a file in this folder that default-exports one object. It is
 * loaded by being here - there is no list to keep in step, because a list
 * is a second place to forget something.
 *
 * Every gate must declare `because`: the failure that created it. That is
 * the LEARN stage written into the code rather than into a habit. A gate
 * with no recorded failure is a rule somebody felt like adding, and this
 * loader refuses it - the whole value of the system is that it gets
 * stricter for reasons that are still legible a year later.
 *
 *   {
 *     id:      'background-flat',
 *     tier:    'code' | 'vision',
 *     what:    one line, present tense, what it measures
 *     because: the specific failure that made it necessary
 *     applies(asset) -> boolean
 *     async run(ctx) -> { pass, score, detail }
 *   }
 *
 * ctx = { img, small, alpha, asset, bible, cfg }
 */
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// The one file here that is not a gate. Everything else in this folder
// is loaded by being in it - a list to keep in step is a second place to
// forget something - and the loader refuses anything without a gate's
// shape, so a mistake here fails loudly rather than silently.
const NOT_GATES = new Set(['index.mjs', 'repo-hygiene.mjs'])

let cache = null

export async function gates() {
  if (cache) return cache
  const files = readdirSync(HERE).filter((f) => f.endsWith('.mjs') && !NOT_GATES.has(f)).sort()
  const out = []
  for (const f of files) {
    const mod = await import(pathToFileURL(join(HERE, f)).href)
    const g = mod.default
    if (!g || typeof g.run !== 'function') throw new Error(`gates/${f} does not default-export a gate with run().`)
    for (const k of ['id', 'tier', 'what', 'because']) {
      if (!g[k]) {
        throw new Error(
          `gates/${f} is missing "${k}".` +
            (k === 'because'
              ? ' Every gate records the failure that created it; a rule with no' +
                ' failure behind it is a preference, and preferences do not get to' +
                ' fail a build.'
              : ''),
        )
      }
    }
    g.file = f
    out.push(g)
  }
  cache = out
  return out
}

/** Read a threshold: the asset may override the bible, the bible may
    override the gate's own default. Art is project-specific; the
    measurement is not. */
export function config(bible, asset, id) {
  return (key, fallback) => {
    const a = asset?.gates?.[id]?.[key]
    if (a !== undefined) return a
    const b = bible?.gates?.[id]?.[key]
    if (b !== undefined) return b
    return fallback
  }
}
