/**
 * Nothing may leave the frame it is drawn into.
 */
export default {
  id: 'motion-canvas-clip',
  tier: 'motion',
  what: 'no part of the rig reaches outside the canvas at any instant of the clip',
  because:
    'A cut source is trimmed to its subject, so the rig canvas derived from it is exactly ' +
    'the silhouette STANDING STILL. The moment a part rotates outward it needs room that ' +
    'box does not have, and the renderer crops back to the canvas - because a frame must ' +
    'always be the declared size - so the part is sliced off against a straight edge.\n\n' +
    'It took the tip clean off this fox\'s tail, in every frame of every clip, and it shipped: ' +
    'rig-rest-fidelity passed because the REST pose is exactly the source, every motion gate ' +
    'passed because the motion itself was correct, and a contact sheet of the strip is small ' +
    'enough that a flat-ended tail reads as a flat-ended tail. Eivan found it by watching a ' +
    'video.\n\n' +
    'The rig stage now measures the motion extent and grows the canvas to fit, so this should ' +
    'never fire. That is exactly when a gate is worth having: it is the proof the fix is still ' +
    'working, and the alternative is trusting that nobody ever hand-edits a canvas or adds a ' +
    'clip with a bigger swing than the one the canvas was measured against.',

  applies: () => true,

  async run({ rig, clip, poseAt, solve, cfg }) {
    const { rotatedPivot } = await import('../lib/pose.mjs')
    const span = clip.period ?? 4
    const N = cfg('samples', 48)
    const slack = cfg('slack', 1) // a pixel of rounding is not a defect
    let worst = null

    for (let i = 0; i <= N; i++) {
      const t = (i * span) / N
      for (const s of solve(rig, poseAt(clip, t))) {
        const box = s.part.box
        if (!box) continue
        const r = rotatedPivot(box.width, box.height, s.part.pivotPx, s.angle)
        const l = s.pivot[0] - r.x, top = s.pivot[1] - r.y
        const over = Math.max(
          -l, -top, l + r.W - rig.canvas.w, top + r.H - rig.canvas.h,
        )
        if (over > (worst?.over ?? -Infinity)) worst = { over, id: s.id, t }
      }
    }

    if (!worst) return { pass: true, score: 1, detail: 'no part carries a box to measure' }
    const pass = worst.over <= slack
    return {
      pass,
      score: pass ? 1 : 0,
      detail: pass
        ? `everything stays inside the ${rig.canvas.w}x${rig.canvas.h} canvas, closest approach ${(-worst.over).toFixed(1)}px`
        : `${worst.id} reaches ${worst.over.toFixed(1)}px outside the ${rig.canvas.w}x${rig.canvas.h} canvas at t=${worst.t.toFixed(2)} ` +
          `and would be sliced off against a straight edge. Re-run the rig stage, which measures the motion and grows the canvas.`,
    }
  },
}
