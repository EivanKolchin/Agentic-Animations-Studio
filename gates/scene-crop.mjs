/**
 * A subject must survive every crop.
 */
export default {
  id: 'scene-crop',
  tier: 'scene',
  what: 'every layer marked keep is almost entirely inside every declared frame, at every instant',
  because:
    'One world cropped into two shapes is the whole reason a site loop and a vertical clip ' +
    'are the same animation. It is also the whole risk: a 9:16 window taken out of a wide ' +
    'world is narrow, and the classic way social repurposing fails is that the subject is ' +
    'half outside it. Nobody catches this by looking at the wide version, which is the one ' +
    'that gets looked at, and a still at t=0 will not catch it either - a fox with a tail ' +
    'that swings can be fully inside the frame at rest and clipped a second later.\n\n' +
    'So it is measured per layer, per frame, ACROSS THE CLIP, in the world\'s own ' +
    'coordinates. A layer that is meant to run off the edge - a backdrop, a foreground ' +
    'blade of grass - simply does not declare keep.',

  applies: (scene) => scene.layers.some((l) => l.keep),

  async run({ scene, composeWorld, cropOf, cfg }) {
    const sharp = (await import('sharp')).default
    const period = scene.period || 4
    // Enough instants to catch a limb at full extension without rendering
    // the whole clip: the extremes are what clip, and they are smooth.
    const N = cfg('samples', 8)
    const need = cfg('minInside', 0.98)
    const problems = []
    const notes = []

    for (const layer of scene.layers.filter((l) => l.keep)) {
      const others = scene.layers.map((l) => (l.id === layer.id ? l : { ...l, hidden: true }))
      // TRANSPARENT ground for the solo render. A scene may declare an
      // opaque background - most do, so no gap can show through - and
      // with it every pixel in the world counts as the layer's own. The
      // first run of this gate reported 56.3% for two different layers,
      // which is 1080/1920: it was measuring the backdrop's share of the
      // crop and calling it the fox.
      const solo = { ...scene, layers: others, background: { r: 0, g: 0, b: 0, alpha: 0 } }
      // Infinity, not 1: starting at 1 means a layer fully inside every frame
      // never records WHICH frame was tightest, and the report says "null".
      let worst = { share: Infinity, frame: null, t: 0 }
      for (let i = 0; i < N; i++) {
        const t = (i * period) / N
        // The layer ALONE in the world, so its own pixels can be counted
        // without anything drawn over them.
        const world = await composeWorld(solo, t)
        const { data, info } = await sharp(world).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        let total = 0
        const inside = new Map(Object.keys(scene.frames).map((f) => [f, 0]))
        for (let y = 0; y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            if (data[(y * info.width + x) * 4 + 3] < 128) continue
            total++
            for (const [name, f] of Object.entries(scene.frames)) {
              const [cx, cy, cw, ch] = cropOf(f)
              if (x >= cx && x < cx + cw && y >= cy && y < cy + ch) inside.set(name, inside.get(name) + 1)
            }
          }
        }
        if (!total) {
          problems.push(`${layer.id} draws nothing at t=${t.toFixed(2)}`)
          continue
        }
        for (const [name, n] of inside) {
          const share = n / total
          if (share < worst.share) worst = { share, frame: name, t }
        }
      }
      const line = `${layer.id}: ${(worst.share * 100).toFixed(1)}% inside "${worst.frame}" at its worst (t=${worst.t.toFixed(2)})`
      if (worst.share < need) problems.push(line)
      else notes.push(line)
    }

    return {
      pass: !problems.length,
      score: problems.length ? 0 : 1,
      detail: problems.length
        ? problems.join('; ') + ` (need ${(need * 100).toFixed(0)}%) - move the layer, widen the crop, or drop its keep`
        : notes.join('; ') || 'no layer declares keep',
    }
  },
}
