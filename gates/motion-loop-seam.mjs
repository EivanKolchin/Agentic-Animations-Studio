/**
 * A loop must actually close.
 */
export default {
  id: 'motion-loop-seam',
  tier: 'motion',
  what: 'the frame at t=0 and the frame one period later are the same picture',
  because:
    'A clip declares a period, and everything downstream believes it: a strip is ' +
    'sampled across it, a GIF is cut to it, a site loops on it. Nothing checks that ' +
    'the number is a true period of the channels underneath, and it usually is not - ' +
    'a channel at 0.66Hz inside a 3-second period completes 1.98 cycles, so the loop ' +
    'ends two hundredths of a cycle from where it started. That is invisible in any ' +
    'single frame and unmissable in the playback, where it reads as a twitch once ' +
    'every three seconds forever. Rendering both ends and subtracting them costs two ' +
    'frames and settles it.',

  applies: (clip) => clip.loop !== false,

  async run({ rig, clip, renderPose, poseAt, cfg }) {
    // Smooth noise is not periodic and never will be, so a clip carrying
    // any is refused as a loop rather than measured as a bad one. That is
    // not a defect - a continuously drifting scene is the right thing for
    // a page that never restarts - but it has to be DECLARED with
    // loop: false, so nothing downstream cuts it into a GIF.
    const noisy = (clip.channels || []).filter((c) => c.noise).map((c) => c.part || c.chain?.join('/'))
    if (noisy.length) {
      return {
        pass: false,
        score: 0,
        detail:
          `${noisy.join(', ')} carry smooth noise, which has no period, so this clip ` +
          `cannot close. Declare "loop": false if it is meant to run forever, or take ` +
          `the noise out if it is meant to loop.`,
      }
    }
    const period = clip.period
    if (!period) return { pass: false, score: 0, detail: 'the clip declares no period, so nothing downstream knows where to cut it' }

    const scale = cfg('scale', 0.35)
    const a = await renderPose(rig, poseAt(clip, 0), { scale })
    const b = await renderPose(rig, poseAt(clip, period), { scale })
    const sharp = (await import('sharp')).default
    const [ra, rb] = await Promise.all([
      sharp(a).ensureAlpha().raw().toBuffer(),
      sharp(b).ensureAlpha().raw().toBuffer(),
    ])
    let diff = 0, moved = 0
    for (let i = 0; i < ra.length; i += 4) {
      const d = Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1]) + Math.abs(ra[i + 2] - rb[i + 2]) + Math.abs(ra[i + 3] - rb[i + 3])
      diff += d
      if (d > 24) moved++
    }
    const pixels = ra.length / 4
    const mean = diff / pixels
    const share = moved / pixels
    const max = cfg('maxMoved', 0.001)
    return {
      pass: share <= max,
      score: 1 - Math.min(1, share / Math.max(max, 1e-9)),
      detail:
        share <= max
          ? `the loop closes: ${(share * 100).toFixed(3)}% of pixels differ across the seam`
          : `${(share * 100).toFixed(2)}% of pixels jump at the seam (max ${(max * 100).toFixed(2)}%), mean ${mean.toFixed(1)}/1020. ` +
            `Check every channel's frequency divides the period.`,
    }
  },
}
