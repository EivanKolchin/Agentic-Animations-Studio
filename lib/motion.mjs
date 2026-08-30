/**
 * Motion, as a function of time.
 *
 * A clip is not a list of keyframes. It is a set of CHANNELS, each a
 * closed-form function evaluated at whatever t it is asked for, and that
 * is the difference between motion that loops and motion that rewinds.
 * Keyframes fail twice and a viewer sees both: five poses over three
 * seconds is five postures with four interpolations between them, eased
 * into every waypoint so the thing crawls between stops rather than
 * moving; and the list ends where it began, so there is a seam, and the
 * eye catches the seam every single cycle.
 *
 * Sampled from sin and from smooth noise there is no seam, because there
 * is no loop point - only a function, evaluated at 30fps for a video and
 * at whatever a display runs at for a preview, from the same numbers.
 *
 * FOLLOW-THROUGH IS A TIME OFFSET, not a second animation. A tail's
 * second segment does what its first segment did, a moment later. That is
 * what follow-through IS, it costs one subtraction, and it cannot drift
 * out of phase with the thing it follows.
 */

// noise and poseAt live in pose.mjs, which imports nothing, because that
// file is shipped verbatim to any project that wants to drive a rig from
// its own clock - or from a scroll position.
export { noise, poseAt } from './pose.mjs'
import { poseAt } from './pose.mjs'

/** The times to sample a clip at, for a strip or a frame stack. */
export function timeline({ seconds = 2, fps = 30 } = {}) {
  const n = Math.max(1, Math.round(seconds * fps))
  return Array.from({ length: n }, (_, i) => i / fps)
}

/**
 * Evenly spaced times across one cycle, for a t-strip.
 *
 * Across the CYCLE rather than across the clip's length, because the
 * question a strip answers is "does this loop smoothly", and the last
 * sample wants to be next to the first.
 */
export function strip(clip, n = 6) {
  const period = clip.period ?? 1 / lowestFreq(clip)
  return Array.from({ length: n }, (_, i) => (i * period) / n)
}

function lowestFreq(clip) {
  const fs = (clip.channels || []).map((c) => c.wave?.freq).filter((f) => f > 0)
  return fs.length ? Math.min(...fs) : 0.5
}
