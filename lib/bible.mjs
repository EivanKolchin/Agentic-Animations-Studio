/**
 * The style bible, and the assembly of prompts from it.
 *
 * THE PROMPT IS NEVER WRITTEN, ONLY ASSEMBLED. That is the single rule
 * this file exists to enforce, and it is where style drift is actually
 * killed. A hand-written prompt is a fresh negotiation with the model
 * every time: the words move, so the pictures move, and consistency
 * becomes something a human is expected to notice. Here the asset spec
 * supplies only SLOTS - what the subject is, what it is doing - and every
 * other clause comes from the bible in a fixed order. Two assets written
 * six weeks apart differ in exactly the ways they were meant to.
 *
 * A spec carrying its own `prompt` is refused rather than merged, because
 * a mechanism with an escape hatch is a convention, and conventions are
 * what this system was built to stop relying on.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { BIBLE } from './env.mjs'
import { hex } from './colour.mjs'

const REQUIRED = ['idiom', 'palette', 'light', 'texture', 'edges', 'bans', 'keyColour']

export function loadBible(dir = BIBLE) {
  const f = join(dir, 'style.json')
  if (!existsSync(f)) {
    throw new Error(
      `No bible at ${f}.\n` +
        'The engine ships without one on purpose: the bible is the project\'s own\n' +
        'visual language, not the studio\'s. Copy bible/style.example.json to\n' +
        'bible/style.json and fill it in - it is git-ignored, and it is the thing\n' +
        'every prompt is assembled from.',
    )
  }
  const b = JSON.parse(readFileSync(f, 'utf8'))
  b.dir = dir
  return b
}

/** Schema check. Not a gate file, because a broken bible is not a bad
    picture - it is a reason no picture can be made yet. */
export function checkBible(b) {
  const problems = []
  for (const k of REQUIRED) if (b[k] === undefined) problems.push(`missing "${k}"`)
  if (b.palette) {
    const entries = Object.entries(b.palette).filter(([k]) => !k.startsWith('_'))
    if (!entries.length) problems.push('palette is empty - there is nothing for the palette gate to measure against')
    for (const [k, v] of entries) {
      try {
        hex(v)
      } catch {
        problems.push(`palette.${k} is not a hex colour: ${JSON.stringify(v)}`)
      }
    }
  }
  for (const k of ['keyColour', 'darkKeyColour']) {
    if (b[k]) {
      try {
        hex(b[k])
      } catch {
        problems.push(`${k} is not a hex colour: ${JSON.stringify(b[k])}`)
      }
    }
  }
  if (b.bans && !Array.isArray(b.bans)) problems.push('bans must be a list')
  return problems
}

const list = (a) => (Array.isArray(a) ? a : [a]).filter(Boolean)

/**
 * Build one asset's prompt. The order is fixed and the wording is the
 * bible's; only the subject and its action come from the spec.
 */
export function assemblePrompt(bible, asset) {
  if (asset.prompt) {
    throw new Error(
      `Asset "${asset.id}" carries a hand-written prompt.\n` +
        'Prompts are assembled from the bible, never written: a spec that can\n' +
        'override the assembly is a spec that will, and then the bible is\n' +
        'documentation rather than a mechanism. Put the wording in the bible if\n' +
        'the whole world should have it, or in this asset\'s `subject`/`notes` if\n' +
        'only this picture should.',
    )
  }
  if (!asset.subject) throw new Error(`Asset "${asset.id}" has no subject.`)

  const p = []
  p.push(bible.idiom)
  // The subject opens a sentence, so it is capitalised here rather than in
  // the spec: an author writing "the sitting fox" in a slot is describing a
  // thing, not composing a line, and every spec in the bank would otherwise
  // carry the same avoidable defect.
  const subject = asset.subject.charAt(0).toUpperCase() + asset.subject.slice(1)
  p.push(subject + (asset.action ? `, ${asset.action}` : '') + '.')
  if (asset.notes) p.push(asset.notes)

  const named = Object.entries(bible.palette)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `${k} ${v}`)
  p.push(`Palette, and nothing outside it: ${named.join(', ')}.`)

  if (bible.light) {
    p.push(
      typeof bible.light === 'string'
        ? bible.light
        : `Light from the ${bible.light.direction}, ${bible.light.quality}.`,
    )
  }
  p.push(`Surfaces ${bible.texture}. Edges ${bible.edges}.`)

  const key = asset.key || bible.keyColour
  if (key && !asset.bleed) {
    p.push(
      `The subject is alone on a completely flat ${key} background that fills the ` +
        `frame to every edge - one solid colour, no gradient, no vignette, no ` +
        `ground, no cast shadow, no glow or light spill around the subject. Leave ` +
        `clear space between the subject and all four edges.`,
    )
  }

  if (asset.sheet) {
    const { cols, rows, cells } = asset.sheet
    p.push(
      `Draw this as one sheet of ${cols * rows} separate figures in a strict ${cols} ` +
        `by ${rows} grid, evenly spaced, each figure fully inside its own cell with ` +
        `clear background all the way around it and no figure touching or ` +
        `overlapping another` +
        (cells?.length ? `. In reading order: ${cells.join('; ')}.` : '.'),
    )
  }

  if (asset.aspect) p.push(`Aspect ratio ${asset.aspect}.`)

  const bans = [...list(bible.bans), ...list(asset.bans)]
  if (bans.length) p.push(`Never: ${bans.join('; ')}.`)

  return p.join(' ')
}

/** The reference images a generation should carry, as absolute paths. */
export function referencesFor(bible, asset) {
  const refs = [...list(bible.references), ...list(asset.references)]
  return refs.map((r) => (r.startsWith('.') || r.includes(':') ? r : join(bible.dir, r)))
}
