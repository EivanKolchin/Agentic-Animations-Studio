/**
 * A bend chain must bend, not break.
 */
export default {
  id: 'motion-joint-seam',
  tier: 'motion',
  what: 'the step left at each parented joint by the clip\'s own rotation stays under a fraction of the part\'s width',
  because:
    'A cut-out limb turning at a joint has one edge that gives it away. The child is drawn ' +
    'over the parent so the joint itself is covered, but the child\'s covering skirt has to ' +
    'END somewhere, and at that row the child and the parent are at different angles - so ' +
    'the outline steps sideways by the skirt\'s length times the sine of the angle between ' +
    'them.\n\n' +
    'On a fox at two degrees this is a third of a pixel and nobody will ever see it. On a ' +
    'dandelion stem cut into three segments at four and a half degrees each it was two and a ' +
    'half pixels on a thirty-six pixel stem, and it reads as the stem being BROKEN rather ' +
    'than bent, which is the one thing a bend chain exists to avoid. It is also invisible ' +
    'at rest, invisible in a thumbnail, and invisible in a contact sheet.\n\n' +
    'The trap in fixing it is that a longer skirt makes it WORSE, not better: displacement ' +
    'grows with distance from the pivot. The skirt has to be long enough to cover the ' +
    'parent\'s moving top edge and no longer, and the angle has to be small enough that what ' +
    'is left is under a pixel. So it is measured rather than argued about.',

  applies: (clip, rig) => rig.parts.some((p) => p.parent),

  async run({ rig, clip, poseAt, cfg }) {
    const sharp = (await import('sharp')).default
    const { join } = await import('node:path')
    const span = clip.period ?? 4
    const N = 96

    // The largest LOCAL rotation each part takes: the angle between it and
    // its parent, which is the only angle the seam cares about.
    const worstLocal = new Map()
    for (let i = 0; i <= N; i++) {
      const pose = poseAt(clip, (i * span) / N)
      for (const [id, v] of Object.entries(pose)) {
        worstLocal.set(id, Math.max(worstLocal.get(id) || 0, Math.abs(v)))
      }
    }

    const byId = new Map(rig.parts.map((p) => [p.id, p]))
    const problems = []
    const notes = []
    for (const p of rig.parts) {
      if (!p.parent) continue
      const parent = byId.get(p.parent)
      const deg = worstLocal.get(p.id) || 0
      if (deg < 0.05) continue
      // A child drawn BEHIND its parent has no seam: the overlap is
      // covered, and what shows beyond the parent is the part's own body
      // moving, which is the point of it. The first version of this gate
      // measured every parented part and refused a fox tail that is
      // visibly perfect - 279px of "skirt" that is not a skirt at all, it
      // is the tail. Half the proof of a gate is that it fires on nothing
      // else, and this is what that half caught.
      if ((p.z ?? 0) <= (parent.z ?? 0)) continue
      const { data, info } = await sharp(join(rig.dir, p.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      // The skirt: how far the part is drawn BELOW its own pivot.
      let lowest = -1
      for (let y = info.height - 1; y >= 0; y--) {
        let any = false
        for (let x = 0; x < info.width && !any; x++) any = data[(y * info.width + x) * 4 + 3] >= 128
        if (any) { lowest = y; break }
      }
      // Only the part of the skirt that is still INSIDE the parent can
      // step against it. Past the parent's own edge the child is drawn
      // over background, where there is nothing to be out of line with.
      // Boxes come from the rig stage. A rig assembled by hand may not
      // carry them, and then the honest answer is to measure the whole
      // skirt rather than to skip the part - erring toward reporting.
      const parentBottomLocal =
        parent.box && p.box ? parent.box.top + parent.box.height - p.box.top : Infinity
      const seamRow = Math.min(lowest, Math.round(Math.min(parentBottomLocal, info.height)))
      const skirt = Math.max(0, seamRow - p.pivotPx[1])
      if (skirt <= 0) continue
      // The part's drawn width at the skirt's end, which is what the step
      // is measured against - a two pixel step on a stem is a break and on
      // a body is nothing.
      let first = -1, last = -1
      for (let x = 0; x < info.width; x++) {
        if (data[(Math.min(seamRow, info.height - 1) * info.width + x) * 4 + 3] >= 128) {
          if (first < 0) first = x
          last = x
        }
      }
      const width = Math.max(1, last - first + 1)
      const step = skirt * Math.sin((deg * Math.PI) / 180)
      const share = step / width
      const max = cfg('maxStepShare', 0.06)
      const line = `${p.id}: ${step.toFixed(1)}px step on a ${width}px edge (${(share * 100).toFixed(0)}%) - ${skirt.toFixed(0)}px of skirt at ${deg.toFixed(1)} degrees`
      if (share > max) problems.push(line)
      else notes.push(line)
    }

    return {
      pass: !problems.length,
      score: problems.length ? 0 : 1,
      detail: problems.length
        ? problems.join('; ') + ` (max ${(cfg('maxStepShare', 0.06) * 100).toFixed(0)}%) - shorten the skirt or turn less per segment`
        : notes.length
          ? 'joints stay closed: ' + notes.join('; ')
          : 'no parented part draws below its own pivot',
    }
  },
}
