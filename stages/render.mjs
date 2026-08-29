/**
 * RENDER - strips, frame stacks and video, from the same numbers.
 *
 * A clip is a function of time, so rendering it at 30fps for a video and
 * at six evenly spaced instants for a strip are the same operation asked
 * for different t. Nothing is re-authored per output, which is the whole
 * reason a site preview and a 9:16 export can be the same animation
 * rather than two that look alike.
 *
 * The STRIP is the one to reach for first. A loop that snaps shows up as
 * a jump between the last cell and the first, and that is visible in a
 * still picture - no player, no browser, no frame timing to argue with.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { loadRig } from '../lib/rig.mjs'
import { poseAt, timeline, strip as stripTimes } from '../lib/motion.mjs'
import { renderPose, tStrip } from '../lib/render.mjs'
import { CANON, ensure } from '../lib/env.mjs'

function clipOf(rig, name) {
  const clips = rig.clips || {}
  if (!name) {
    const first = Object.keys(clips)[0]
    if (!first) throw new Error(`${rig.name} has no clips. Declare one under "clips" in canon/${rig.name}/parts.json and re-run the rig stage.`)
    return { name: first, clip: clips[first] }
  }
  if (!clips[name]) throw new Error(`${rig.name} has no clip called "${name}". It has: ${Object.keys(clips).join(', ') || '(none)'}`)
  return { name, clip: clips[name] }
}

export async function renderStrip(rigName, { clip: clipName, frames = 6, scale = 0.5, log = console.log } = {}) {
  const rig = loadRig(CANON, rigName)
  const { name, clip } = clipOf(rig, clipName)
  const times = stripTimes(clip, frames)
  const out = join(ensure(join(rig.dir, 'renders')), `${rigName}-${name}-strip.png`)
  const r = await tStrip(rig, clip, times, out, { scale, poseAt })
  log(`  ${r.out}  ${r.frames} frames  ${r.kb} KB`)
  return r
}

/** A pose sheet: the rig held still in each named pose. What a rig is FOR
    is that these are not new drawings, so seeing them together is how you
    find the pose that only works because a limb happens to hide a seam. */
export async function renderPoses(rigName, { scale = 0.5, log = console.log } = {}) {
  const rig = loadRig(CANON, rigName)
  const poses = rig.poses || {}
  const names = Object.keys(poses)
  if (!names.length) throw new Error(`${rigName} declares no poses.`)
  const out = join(ensure(join(rig.dir, 'renders')), `${rigName}-poses.png`)
  const fake = { channels: [] }
  const r = await tStrip(rig, fake, names.map((_, i) => i), out, {
    scale,
    poseAt: (_, i) => poses[names[i]],
  })
  log(`  ${r.out}  ${names.length} poses  ${r.kb} KB`)
  return r
}

/**
 * A frame stack, and optionally an MP4 through ffmpeg.
 *
 * The frames are written whether or not ffmpeg exists, because they are
 * the deliverable that always works: a stack of PNGs can be turned into
 * anything later, on any machine, and a pipeline that fails at the last
 * step having produced nothing is worse than one that produces frames.
 */
export async function renderFrames(rigName, { clip: clipName, fps = 30, seconds, scale = 1, video = false, log = console.log } = {}) {
  const rig = loadRig(CANON, rigName)
  const { name, clip } = clipOf(rig, clipName)
  const secs = seconds ?? clip.period ?? 2
  const dir = ensure(join(rig.dir, 'renders', `${name}-${fps}fps`))
  for (const f of readdirSync(dir)) rmSync(join(dir, f))
  const times = timeline({ seconds: secs, fps })
  for (let i = 0; i < times.length; i++) {
    const buf = await renderPose(rig, poseAt(clip, times[i]), { scale })
    writeFileSync(join(dir, String(i).padStart(4, '0') + '.png'), buf)
  }
  log(`  ${times.length} frames at ${fps}fps (${secs}s) in ${dir}`)
  if (!video) return { dir, frames: times.length }

  const mp4 = join(rig.dir, 'renders', `${rigName}-${name}.mp4`)
  try {
    execFileSync(
      'ffmpeg',
      [
        '-y', '-framerate', String(fps),
        '-i', join(dir, '%04d.png'),
        // yuv420p and even dimensions, or half the players in the world
        // refuse it; the pad is what makes an odd-sized rig exportable at
        // all rather than failing at the last step.
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
        '-pix_fmt', 'yuv420p', '-crf', '18',
        mp4,
      ],
      { stdio: 'pipe' },
    )
    log(`  ${mp4}`)
    return { dir, frames: times.length, mp4 }
  } catch (e) {
    log(`  frames written, but no video: ${/ENOENT/.test(String(e)) ? 'ffmpeg is not on PATH' : String(e.message).split('\n')[0]}`)
    return { dir, frames: times.length }
  }
}
