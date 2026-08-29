/**
 * A sheet has to be sliceable.
 */
export default {
  id: 'sheet-registration',
  tier: 'code',
  what: 'every declared cell of a sprite sheet holds exactly one subject, clear of its gutters',
  because:
    'Generating a set of poses as one sheet is the single strongest weapon against ' +
    'drift - one lighting, one palette, one hand, by construction. It is also the one ' +
    'that fails silently: the model returns five poses where six were asked for, or ' +
    'lets a tail cross a gutter, and the slice is done by arithmetic that cannot see ' +
    'either. A leg cut in half is discovered on the site. Cells are therefore measured ' +
    'before anything is sliced: occupied, alone, and inside their own borders.',

  applies: (asset) => !!asset.sheet && !!asset.key,

  async run({ small, mask, asset, cfg }) {
    const { components, maskBox } = await import('../lib/mask.mjs')
    const { w, h } = small
    const { cols, rows } = asset.sheet
    const cw = w / cols, ch = h / rows
    const gutter = cfg('gutter', 0.02) // fraction of a cell that must stay clear
    const minFill = cfg('minFill', 0.02) // a cell this empty holds nothing
    const problems = []
    const cells = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor(c * cw), y0 = Math.floor(r * ch)
        const x1 = Math.floor((c + 1) * cw), y1 = Math.floor((r + 1) * ch)
        const cwPx = x1 - x0, chPx = y1 - y0
        const sub = new Uint8Array(cwPx * chPx)
        let n = 0
        for (let y = 0; y < chPx; y++) {
          for (let x = 0; x < cwPx; x++) {
            const v = mask[(y0 + y) * w + x0 + x]
            sub[y * cwPx + x] = v
            n += v
          }
        }
        const fill = n / (cwPx * chPx)
        const name = asset.sheet.cells?.[r * cols + c] || `r${r + 1}c${c + 1}`
        const box = maskBox(sub, cwPx, chPx)
        const gx = Math.max(1, Math.round(cwPx * gutter)), gy = Math.max(1, Math.round(chPx * gutter))
        const touches =
          box &&
          (box.left < gx || box.top < gy || box.left + box.width > cwPx - gx || box.top + box.height > chPx - gy)
        // Fragments are counted at 0.5% of the cell: a subject that has shed
        // a floating ear is as unsliceable as one that crossed a gutter.
        const parts = components(sub, cwPx, chPx, Math.max(8, Math.round(cwPx * chPx * 0.005))).length
        cells.push({ name, fill: +fill.toFixed(3), parts, box })
        if (fill < minFill) problems.push(`${name} is empty (${(fill * 100).toFixed(1)}% filled)`)
        else if (touches) problems.push(`${name} touches its gutter - the slice would cut it`)
        else if (parts > 1) problems.push(`${name} holds ${parts} separate pieces, not one subject`)
      }
    }
    return {
      pass: !problems.length,
      score: 1 - problems.length / cells.length,
      detail: problems.length ? problems.join('; ') : `${cells.length} cells, each one subject, all clear of gutters`,
      cells,
    }
  },
}
