/**
 * SCENE - the last mile, and the same one for both shapes.
 *
 * A scene is composed once into a world and cropped into every declared
 * frame, so a site loop and a vertical clip are two rectangles of the
 * same pixels. Nothing is re-timed, re-placed or re-approved per output.
 *
 * The strip is still the first thing to look at: a scene that reads at
 * six stills reads in motion, and a scene that does not cannot be fixed
 * by watching it play.
 */
import { writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
import { loadScene, checkScene, composeWorld, takeFrame, scenePeriod } from '../lib/scene.mjs'
import { STUDIO, ensure, ffmpeg } from '../lib/env.mjs'

const RENDERS = join(STUDIO, 'scenes', 'renders')

function open(name) {
  const s = loadScene(name)
  const problems = checkScene(s)
  if (problems.length) throw new Error(`The scene is not renderable:\n  - ${problems.join('\n  - ')}`)
  return s
}

/** A row of instants, per frame, so both shapes can be read side by side. */
export async function sceneStrip(name, { frames = 5, scale = 0.4, log = console.log } = {}) {
  const scene = open(name)
  const period = scenePeriod(scene)
  const times = Array.from({ length: frames }, (_, i) => (i * period) / frames)
  const out = ensure(join(RENDERS, name))
  const made = []

  for (const frameName of Object.keys(scene.frames)) {
    const cells = []
    for (const t of times) {
      const world = await composeWorld(scene, t)
      cells.push(await takeFrame(scene, world, frameName))
    }
    const m = await sharp(cells[0]).metadata()
    // Every cell is scaled to the same height so a wide frame and a tall
    // one can sit on the same sheet without either being unreadable.
    const H = Math.round(m.height * scale)
    const W = Math.round(m.width * scale)
    const pad = 10, cap = 20
    const sheetW = pad + times.length * (W + pad)
    const sheetH = H + cap + pad * 2
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}">` +
      times
        .map((t, i) => `<text x="${pad + i * (W + pad)}" y="${H + pad + 14}" font-family="ui-sans-serif,Segoe UI,Helvetica,Arial" font-size="12" fill="#333">t = ${t.toFixed(2)}s</text>`)
        .join('') +
      `</svg>`
    const scaled = []
    for (const c of cells) scaled.push(await sharp(c).resize({ width: W, height: H, fit: 'fill' }).png().toBuffer())
    const buf = await sharp({ create: { width: sheetW, height: sheetH, channels: 4, background: '#b9b9b6' } })
      .composite([...scaled.map((input, i) => ({ input, left: pad + i * (W + pad), top: pad })), { input: Buffer.from(svg) }])
      .png()
      .toBuffer()
    const file = join(out, `${name}-${frameName}-strip.png`)
    writeFileSync(file, buf)
    log(`  ${file}  ${times.length} frames of ${m.width}x${m.height}  ${(buf.length / 1024).toFixed(1)} KB`)
    made.push(file)
  }
  return made
}

/** One still of every frame, at full output size. */
export async function scenePoster(name, { at = 0, log = console.log } = {}) {
  const scene = open(name)
  const out = ensure(join(RENDERS, name))
  const world = await composeWorld(scene, at)
  const made = []
  for (const frameName of Object.keys(scene.frames)) {
    const buf = await takeFrame(scene, world, frameName)
    const file = join(out, `${name}-${frameName}.png`)
    writeFileSync(file, buf)
    const m = await sharp(buf).metadata()
    log(`  ${file}  ${m.width}x${m.height}  ${(buf.length / 1024).toFixed(1)} KB`)
    made.push(file)
  }
  return made
}

/**
 * Frame stacks, one directory per declared frame, and an MP4 each if
 * ffmpeg is on PATH.
 *
 * The world is composed ONCE per instant and every frame is cut from it,
 * which is both the correctness argument and most of the speed: two
 * outputs cost one composition.
 */
export async function sceneFrames(name, { fps = 30, seconds, only, video = false, log = console.log } = {}) {
  const scene = open(name)
  const secs = seconds ?? scenePeriod(scene)
  const n = Math.max(1, Math.round(secs * fps))
  const wanted = Object.keys(scene.frames).filter((f) => !only || only.includes(f))
  const dirs = {}
  for (const f of wanted) {
    dirs[f] = ensure(join(RENDERS, name, `${f}-${fps}fps`))
    for (const old of readdirSync(dirs[f])) rmSync(join(dirs[f], old))
  }

  for (let i = 0; i < n; i++) {
    const world = await composeWorld(scene, i / fps)
    for (const f of wanted) {
      writeFileSync(join(dirs[f], String(i).padStart(4, '0') + '.png'), await takeFrame(scene, world, f))
    }
    if (i % 15 === 0) log(`  ${i}/${n}`)
  }
  log(`  ${n} frames at ${fps}fps (${secs}s) for ${wanted.join(', ')}`)

  const made = { dirs, frames: n }
  if (!video) return made
  made.video = []
  for (const f of wanted) {
    const mp4 = join(RENDERS, name, `${name}-${f}.mp4`)
    try {
      execFileSync(
        ffmpeg(),
        ['-y', '-framerate', String(fps), '-i', join(dirs[f], '%04d.png'),
          '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p', '-crf', '18', mp4],
        { stdio: 'pipe' },
      )
      log(`  ${mp4}`)
      made.video.push(mp4)
    } catch (e) {
      log(`  frames written, but no video for ${f}: ${/ENOENT/.test(String(e)) ? 'ffmpeg was not found - set STUDIO_FFMPEG in .env or put it on PATH' : String(e.message).split('\n')[0]}`)
    }
  }
  return made
}

export { open as openScene }

/**
 * The scene-tier gates.
 *
 * Handed the scene plus the two functions it needs to answer anything -
 * how to compose a world and where a frame's crop is - so a gate never
 * has to know how a scene is stored, only what it means.
 */
export async function sceneGates(name, { log = console.log } = {}) {
  const { gates, config } = await import('../gates/index.mjs')
  const scene = open(name)
  const all = (await gates()).filter((g) => g.tier === 'scene')
  const results = []
  for (const g of all) {
    if (g.applies && !g.applies(scene)) {
      results.push({ id: g.id, skipped: true, detail: 'does not apply to this scene' })
      continue
    }
    let r
    try {
      r = await g.run({ scene, composeWorld, takeFrame, cropOf: (f) => f.crop, cfg: config(null, scene, g.id) })
    } catch (e) {
      r = { pass: false, score: 0, detail: `gate errored: ${e.message}` }
    }
    results.push({ id: g.id, ...r })
    log(`  ${r.pass === false ? 'X' : ' '} ${g.id.padEnd(18)} ${r.detail}`)
  }
  return { scene: name, results, pass: !results.some((r) => r.pass === false) }
}
