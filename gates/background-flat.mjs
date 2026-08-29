/**
 * The background must actually be the key colour, flat, all the way to
 * the edge.
 */
export default {
  id: 'background-flat',
  tier: 'code',
  what: 'the border of the frame is the declared key colour and nothing else',
  because:
    'An image model asked for "a fox on flat magenta" will cheerfully paint a ' +
    'gradient, a vignette, or a hint of grass along the bottom, and every one of ' +
    'those survives keying as a band of colour welded to the sprite. It is invisible ' +
    'in the candidate at thumbnail size and obvious the moment the sprite is ' +
    'composited over something else - which is three stages later, after selection.',

  applies: (asset) => !!asset.key,

  async run({ small, dist, lo, asset, cfg }) {
    const { w, h } = small
    const band = Math.max(2, Math.round(Math.min(w, h) * cfg('band', 0.04)))
    // A BACKDROP is keyed on some edges and not others: a hill line runs to
    // the bottom of its frame on purpose and only its sky comes out. So the
    // asset says which edges are supposed to be background, and the default
    // - all four - is the ordinary case of a subject floating in a field.
    const edges = new Set(asset.keyEdges || ['top', 'right', 'bottom', 'left'])
    // Two numbers, each measuring one thing. PURITY is how much of the
    // border is the key at all - a subject leaning into the frame, a strip
    // of painted grass. SPREAD is whether the key field itself is graded,
    // and it is measured over the CLEAN pixels only: including the others
    // makes a single bright intruder swamp the variance, and then the two
    // numbers are both reporting the intruder and nothing is reporting the
    // gradient they were split up to tell apart.
    let n = 0, clean = 0, sum = 0, sum2 = 0, worst = 0
    if (!edges.size) return { pass: true, score: 1, detail: 'asset declares no keyed edges' }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const edge =
          (edges.has('left') && x < band) ||
          (edges.has('top') && y < band) ||
          (edges.has('right') && x >= w - band) ||
          (edges.has('bottom') && y >= h - band)
        if (!edge) continue
        const d = dist[y * w + x]
        n++
        if (d <= lo) {
          clean++
          sum += d
          sum2 += d * d
        }
        if (d > worst) worst = d
      }
    }
    const purity = clean / n
    const spread = clean ? Math.sqrt(Math.max(0, sum2 / clean - (sum / clean) ** 2)) : 1
    const minPurity = cfg('purity', 0.97)
    const maxSpread = cfg('spread', 0.02)
    const pass = purity >= minPurity && spread <= maxSpread
    return {
      pass,
      score: purity,
      detail:
        `${[...edges].join('/')} border ${(purity * 100).toFixed(1)}% key ` +
        `(need ${(minPurity * 100).toFixed(0)}%), ` +
        `spread ${spread.toFixed(3)} (max ${maxSpread}), worst dE ${worst.toFixed(2)}`,
    }
  },
}
