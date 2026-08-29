/**
 * What a production has spent, and what it is allowed to spend.
 *
 * The cap is not a safety rail bolted on afterwards - it is written into
 * the brief, which means the number was chosen by whoever approved the
 * work rather than discovered afterwards on a bill. Generation is the
 * only paid step here, so it is the only one counted, and every call is
 * recorded with the model that served it so a run can be read back.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { creditCap } from './env.mjs'

export function ledger(dir) {
  const f = join(dir, 'ledger.json')
  const read = () => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { cap: null, spent: 0, calls: [] })
  const write = (l) => writeFileSync(f, JSON.stringify(l, null, 2) + '\n')

  return {
    read,
    /** The cap in force: the brief's, or the environment's default. */
    cap(briefCap) {
      const l = read()
      if (briefCap != null) {
        l.cap = briefCap
        write(l)
      }
      return l.cap ?? creditCap()
    },
    remaining(briefCap) {
      return this.cap(briefCap) - read().spent
    },
    /** Refuse before spending, not after. */
    check(n, { force = false, briefCap } = {}) {
      const l = read()
      const cap = this.cap(briefCap)
      if (!force && l.spent + n > cap) {
        throw new Error(
          `This would be generation ${l.spent + n} of a ${cap} cap for this production.\n` +
            'Raise the cap in brief.md and re-run, or pass --force to go past it once\n' +
            '(which is recorded). The cap exists so a loop costs a number somebody\n' +
            'chose rather than a number nobody watched.',
        )
      }
      return true
    },
    record({ asset, model, forced = false, usage = null }) {
      const l = read()
      l.spent += 1
      l.calls.push({ n: l.spent, asset, model, forced, usage })
      write(l)
      return l.spent
    },
  }
}
