/**
 * The Gemini client - generation and vision, over plain HTTP.
 *
 * No SDK. The whole surface used here is three endpoints and a JSON body,
 * and a generated client would be a dependency to audit, update and
 * explain for the rest of this repo's life in exchange for saving forty
 * lines. `fetch` is in the runtime.
 *
 * MODEL NAMES ARE DISCOVERED, NEVER HARDCODED. Image model names move
 * every few months, and a constant in a file is a system that breaks
 * quietly on somebody else's release schedule. The CLI asks the API what
 * exists, ranks what it finds, and writes the choice into the run's
 * report so the picture and the model that made it stay attached.
 */
import sharp from 'sharp'
import { apiKey, env, ensure, CACHE } from './env.mjs'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const API = 'https://generativelanguage.googleapis.com/v1beta'

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.webp': 'image/webp' }

/**
 * How long to wait before trying again.
 *
 * Google says so in the error text - "Please retry in 29.185250179s" - and
 * an exponential guess ignores it. That mattered the first time the vision
 * pass ran wide: a per-MINUTE quota was answered with backoffs of 1.5, 3
 * and 6 seconds, so all three retries fell inside the same exhausted
 * minute and every one of them failed. Capped, because a server asking for
 * ten minutes is a server to give up on and report.
 */
function waitFor(text, attempt) {
  const m = /retry in ([\d.]+)s/i.exec(text)
  const asked = m ? Number(m[1]) * 1000 : 0
  return Math.min(60_000, Math.max(asked + 500, 1500 * 2 ** attempt))
}

async function call(path, { method = 'GET', body, tries = 4 } = {}) {
  const url = `${API}/${path}${path.includes('?') ? '&' : '?'}key=${apiKey()}`
  let last
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.ok) return res.json()
    const text = await res.text()
    last = new Error(`${res.status} ${res.statusText}: ${summarise(text)}`)
    // A 429 whose quota limit is ZERO is not a rate limit, it is a closed
    // door: the project has no allowance for this model at all, and waiting
    // is the one thing that cannot help. Distinguishing the two is worth the
    // twelve lines, because the alternative is three backoffs and a
    // truncated JSON blob for a problem whose fix is a billing page.
    // `limit: 0` appears inside the human message, unquoted, not in the
    // structured QuotaFailure - which is why the first version of this test
    // looked for a JSON field and matched nothing.
    if (res.status === 429 && /\blimit:\s*0\b/.test(text)) throw new Error(noQuota(path, text))
    if (res.status !== 429 && res.status < 500) throw last
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitFor(text, i)))
  }
  throw last
}

/** Pull the human sentence out of a Google error body, or fall back to the
    first of the JSON. Whole error payloads in a terminal read as noise. */
function summarise(text) {
  try {
    const m = JSON.parse(text)
    return (m.error?.message || '').split('\n')[0] || text.slice(0, 300)
  } catch {
    return text.slice(0, 300)
  }
}

/** The message for a quota of zero, which is a different problem from the
    same status code meaning "slow down". */
function noQuota(path, text) {
  const model = (/models\/([^:]+):/.exec(path) || [])[1] || 'that model'
  const metric = /free_tier/.test(text) ? 'free tier' : 'this project'
  return (
    `${model} is not available to this key: ${metric} allows ZERO requests for it,\n` +
    'so this is a closed door rather than a rate limit and retrying cannot open it.\n\n' +
    'Image generation on the Gemini API needs billing enabled on the Google Cloud\n' +
    'project behind the key - text and vision do not, which is why the validators\n' +
    'still work while generation does not. Enable it at ai.dev/rate-limit, or pin a\n' +
    'model the key can reach with STUDIO_IMAGE_MODEL in .env.'
  )
}

/** Every model the key can see, cached for the session - the list costs a
    round trip and does not change inside a run. */
export async function listModels({ refresh = false } = {}) {
  const f = join(ensure(CACHE), 'models.json')
  if (!refresh && existsSync(f)) {
    const c = JSON.parse(readFileSync(f, 'utf8'))
    if (c.models?.length) return c.models
  }
  const out = []
  let page = ''
  do {
    const r = await call(`models?pageSize=200${page ? `&pageToken=${page}` : ''}`)
    out.push(...(r.models || []))
    page = r.nextPageToken || ''
  } while (page)
  writeFileSync(f, JSON.stringify({ models: out }, null, 2))
  return out
}

const version = (name) => {
  const m = /(\d+)\.(\d+)/.exec(name)
  return m ? Number(m[1]) * 100 + Number(m[2]) : 0
}

/**
 * Choose a model for a job. `kind` is what the job needs, not a name:
 *   image  - returns pictures
 *   flash  - cheap vision, for scoring every candidate
 *   pro    - expensive vision, for judgment between finalists
 *
 * An explicit STUDIO_IMAGE_MODEL / STUDIO_VISION_MODEL wins, because a
 * run that has to be reproduced exactly must be able to pin one.
 */
export async function pickModel(kind) {
  const pin = kind === 'image' ? env().STUDIO_IMAGE_MODEL : env().STUDIO_VISION_MODEL
  if (pin) return pin.startsWith('models/') ? pin.slice(7) : pin
  const models = await listModels()
  const usable = models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
  const named = usable.map((m) => ({ ...m, short: m.name.replace(/^models\//, '') }))
  let pool
  if (kind === 'image') pool = named.filter((m) => /image/.test(m.short) && !/embed/.test(m.short))
  else pool = named.filter((m) => !/image|embed|aqa|tts|live|native-audio/.test(m.short) && /gemini/.test(m.short))
  if (kind === 'flash') pool = pool.filter((m) => /flash/.test(m.short))
  if (kind === 'pro') pool = pool.filter((m) => /pro/.test(m.short))
  if (!pool.length) {
    throw new Error(
      `No model available for "${kind}". The key can see: ` +
        named.map((m) => m.short).slice(0, 20).join(', ') +
        '\nPin one with STUDIO_IMAGE_MODEL / STUDIO_VISION_MODEL in .env.',
    )
  }
  // TIER FIRST, THEN VERSION. Ranking by version alone picked a
  // flash-lite image model over the pro one because its number was
  // higher, which is the wrong answer for the only thing this generates:
  // hero art and canon characters, where a re-roll costs more than the
  // better model does. Cheap tiers are what the VISION side is for.
  pool.sort(
    (a, b) =>
      tier(a.short) - tier(b.short) ||
      version(b.short) - version(a.short) ||
      score(a.short) - score(b.short),
  )
  return pool[0].short
}
const tier = (n) => (/flash-lite|lite/.test(n) ? 2 : /flash/.test(n) ? 1 : 0)
// Among equals prefer the plain name over a dated or preview build: it is
// the one that will still resolve next month.
const score = (n) => (/preview|exp|\d{3,}/.test(n) ? 1 : 0)

/**
 * An image as an inline part, SHRUNK FIRST.
 *
 * A candidate is a two-thousand-pixel PNG and a style reference is a
 * two-megabyte JPEG, and base64 adds a third on top of both. Sending them
 * whole made a single vision call on two candidates take longer than the
 * entire rest of the pipeline, for an answer that does not change: style
 * adherence, off-model drift and "is there a glow" all read at 768px, and
 * a model asked to judge a POSTER does not need the poster's print size.
 *
 * Generation references get a larger cap than vision does, because there
 * the detail is being copied rather than judged.
 */
async function inlineImage(file, maxDim) {
  const meta = await sharp(file).metadata()
  if (Math.max(meta.width || 0, meta.height || 0) <= maxDim) {
    const mime = MIME[extname(file).toLowerCase()] || 'image/png'
    return { inline_data: { mime_type: mime, data: readFileSync(file).toString('base64') } }
  }
  const buf = await sharp(file)
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer()
  return { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } }
}

const inlineAll = (files, maxDim) => Promise.all(files.map((f) => inlineImage(f, maxDim)))

/**
 * One image. References are attached programmatically, which is the other
 * half of killing drift: the master keyframe and the canon character go
 * with every request whether or not anybody remembered them.
 */
export async function generateImage({ prompt, refs = [], model, refSize = 1024 }) {
  const m = model || (await pickModel('image'))
  const parts = [...(await inlineAll(refs, refSize)), { text: prompt }]
  const body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'] } }
  let r
  try {
    r = await call(`models/${m}:generateContent`, { method: 'POST', body })
  } catch (e) {
    // Some image models insist on being allowed to talk as well as draw.
    if (!/responseModalities|modalit/i.test(String(e.message))) throw e
    body.generationConfig.responseModalities = ['TEXT', 'IMAGE']
    r = await call(`models/${m}:generateContent`, { method: 'POST', body })
  }
  const out = (r.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData || p.inline_data)
  const data = out?.inlineData?.data || out?.inline_data?.data
  if (!data) {
    const said = (r.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join(' ')
    const why = r.candidates?.[0]?.finishReason
    throw new Error(`No image came back${why ? ` (${why})` : ''}${said ? `: ${said.slice(0, 300)}` : ''}`)
  }
  return { buffer: Buffer.from(data, 'base64'), model: m, usage: r.usageMetadata || null }
}

/**
 * Ask a vision model a question about pictures and get JSON back.
 *
 * The schema is not politeness - it is what makes the answer a
 * measurement. Free text has to be parsed, and a parser for free text is
 * a place for a bad candidate to slip through by being ambiguous.
 */
export async function askVision({ prompt, images = [], schema, model, kind = 'flash', size = 768 }) {
  const m = model || (await pickModel(kind))
  const parts = [...(await inlineAll(images, size)), { text: prompt }]
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {}),
      temperature: 0,
    },
  }
  const r = await call(`models/${m}:generateContent`, { method: 'POST', body })
  const text = (r.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('')
  if (!text) throw new Error(`No answer from ${m} (${r.candidates?.[0]?.finishReason || 'no reason given'})`)
  try {
    return { answer: JSON.parse(text), model: m, usage: r.usageMetadata || null }
  } catch {
    throw new Error(`${m} did not return JSON: ${text.slice(0, 300)}`)
  }
}
