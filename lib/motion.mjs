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

/** Integer bit-mixer. Not fract(sin(n) * 43758.5): that one aliases on
    lattices like `part * 31.7 + step * 5.3`, which is exactly the shape a
    rig generates, and it once sent seven independent walks the same way. */
function hash(n) {
  let x = n | 0
  x = (x ^ 61) ^ (x >>> 16)
  x = (x + (x << 3)) | 0
  x = x ^ (x >>> 4)
  x = Math.imul(x, 0x27d4eb2d)
  x = x ^ (x >>> 15)
  return ((x >>> 0) % 100000) / 100000
}

/** Quintic fade: zero first AND second derivative at the ends. A cubic
    fade is continuous in value and kinks in velocity, which on a limb
    reads as a tick at every whole second. */
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)

/** Smooth value noise in one dimension, deterministic in (seed, t). */
export function noise(seed, t) {
  const i = Math.floor(t)
  const f = t - i
  const a = hash(i * 374761393 + seed * 668265263)
  const b = hash((i + 1) * 374761393 + seed * 668265263)
  return (a + (b - a) * fade(f)) * 2 - 1
}

const TAU = Math.PI * 2

/**
 * One channel's value at time t, in degrees.
 *
 * `wave` is a sine, `noise` is smooth drift, and a channel may carry both
 * - a tail that swings and also wanders is one channel, not two fighting
 * over the same part.
 */
function channelValue(ch, t) {
  let v = 0
  if (ch.wave) {
    const { amp = 0, freq = 0.5, phase = 0 } = ch.wave
    v += amp * Math.sin(TAU * freq * t + phase)
  }
  if (ch.noise) {
    const { amp = 0, freq = 0.3, seed = 1 } = ch.noise
    v += amp * noise(seed, freq * t)
  }
  if (ch.hold !== undefined) v += ch.hold
  return v
}

/**
 * A clip at time t, as a pose: { partId: degrees }.
 *
 * Channels ADD, so a chain's travelling wave and a whole-body sway can be
 * written separately and read as one movement. Two channels silently
 * replacing each other would make the order they were typed in matter,
 * which is the kind of rule nobody remembers at the point it bites.
 */
export function poseAt(clip, t) {
  const pose = {}
  const add = (id, v) => (pose[id] = (pose[id] || 0) + v)
  for (const ch of clip.channels || []) {
    if (ch.chain) {
      // Down the chain, each segment doing what the one before it did,
      // `lag` seconds later, and optionally softening as it goes.
      const lag = ch.lag ?? 0.1
      const decay = ch.decay ?? 1
      ch.chain.forEach((id, i) => add(id, channelValue(ch, t - i * lag) * decay ** i))
    } else if (ch.part) {
      add(ch.part, channelValue(ch, t - (ch.lag ?? 0)))
    }
  }
  return pose
}

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
