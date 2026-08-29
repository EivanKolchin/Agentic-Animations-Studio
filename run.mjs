#!/usr/bin/env node
/**
 * The studio CLI. Every stage is a subcommand, every stage writes files,
 * and the files are the state - so any session, human or agent, can pick
 * a production up where it was left.
 *
 * Implemented stages report their work; unimplemented ones say so rather
 * than pretending. Run `node run.mjs` for the map.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, copyFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PRODUCTIONS, production, deliverTo, ensure, STUDIO } from './lib/env.mjs'

const STAGES = [
  ['brief', 'agree intent and acceptance in conversation, write brief.md', 'done'],
  ['spec', 'decompose into per-asset specs, prompts assembled from the bible', 'done'],
  ['generate', 'Gemini image generation, N candidates, references attached', 'done'],
  ['validate', 'code gates first, then vision gates; regenerate on failure', 'done'],
  ['select', 'contact sheet of survivors, pick the keepers', 'done'],
  ['cut', 'key, despill, slice, manifest', 'done'],
  ['rig', 'cut the canon into parts, measure the joints', 'done'],
  ['animate', 'motion on the deterministic clock; bend and follow-through', 'done'],
  ['render', 'strips, pose sheets, frame stacks, video via ffmpeg', 'done'],
  ['deliver', 'sprites to the project, or video out; budgets checked', 'done'],
]

/**
 * Arguments. Which flags take a value is DECLARED rather than guessed at,
 * because guessing gets `validate --vision fox` wrong in a way nobody
 * notices: the production name is swallowed as the value of a boolean and
 * the command runs against the wrong thing, or against nothing.
 */
const TAKES_VALUE = new Set(['by', 'only', 'n', 'candidates', 'to', 'budget', 'round', 'from', 'clip', 'frames', 'fps', 'seconds', 'scale'])
const [cmd, ...rest] = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]
  if (!a.startsWith('--')) {
    positional.push(a)
    continue
  }
  const eq = a.indexOf('=')
  const name = eq < 0 ? a.slice(2) : a.slice(2, eq)
  if (eq >= 0) flags[name] = a.slice(eq + 1)
  else if (TAKES_VALUE.has(name)) flags[name] = rest[++i]
  else flags[name] = true
}
const flag = (name, fallback = undefined) => (flags[name] === undefined ? fallback : flags[name])
const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)

/** The date a production is named and approved by. Git's last commit date
    is preferred over the process clock so the folder names line up with
    the history that will hold them - but a repository with no commits yet
    has no date to give, and naming every production of a fresh clone
    "undated" makes the second one collide with the first. */
function today() {
  try {
    const d = execFileSync('git', ['log', '-1', '--format=%cs'], { cwd: STUDIO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (d) return d
  } catch {}
  return new Date().toISOString().slice(0, 10)
}

/**
 * Print the reason and fail.
 *
 * `process.exitCode` rather than `process.exit()`: calling exit while an
 * HTTP socket is still closing trips a libuv assertion on Windows, which
 * replaces a clear message and exit 1 with a crash dump and exit 127.
 * Setting the code lets the loop drain and the message stands as the last
 * thing on screen, which is the whole point of it.
 */
const die = (e) => {
  console.error('\n' + (e instanceof Error ? e.message : String(e)) + '\n')
  process.exitCode = 1
  throw DIED
}
const DIED = Symbol('died')

function help() {
  console.log('\nAgentic Animations Studio\n')
  console.log('  node run.mjs new <slug>                       start a production')
  console.log('  node run.mjs status                           list productions and their stage')
  console.log('  node run.mjs approve <prod> --by "<name>"      record a human approval of the brief')
  console.log('  node run.mjs spec <prod> [--candidates=N]      scaffold and assemble per-asset prompts')
  console.log('  node run.mjs generate <prod> [--only=a,b] [--n=N] [--force]')
  console.log('  node run.mjs validate <prod> [--vision] [--only=a,b]')
  console.log('  node run.mjs sheet <prod> [--only=a,b]         contact sheet of the last round')
  console.log('  node run.mjs pick <prod> <asset>=<candidate>   record a selection')
  console.log('  node run.mjs cut <prod> [--only=a,b]           key, slice, trim, manifest')
  console.log('  node run.mjs canon <name> --from <prod>/<asset> promote a cut asset to canon')
  console.log('  node run.mjs rig <name>                        cut the canon into parts, write rig.json')
  console.log('  node run.mjs strip <name> [--clip=idle] [--frames=6]')
  console.log('  node run.mjs check <name> [--clip=idle]            the motion gates')
  console.log('  node run.mjs frames <name> [--clip=idle] [--fps=30] [--seconds=2] [--video]')
  console.log('  node run.mjs deliver <prod> --yes [--budget=KB]')
  console.log('  node run.mjs bible                            draw the style bible as a sheet')
  console.log('  node run.mjs models                           what the API key can see')
  console.log('  node run.mjs prove                            break the pictures, watch the gates fire')
  console.log('  node run.mjs engine <git args>                 git, aimed at the engine repo')
  console.log('  node run.mjs hygiene [--publish]               no secrets; --publish audits the engine repo\n')
  console.log('Pipeline:')
  for (const [name, what, state] of STAGES) console.log(`  ${state === 'todo' ? ' ' : '*'} ${name.padEnd(9)} ${what}`)
  console.log('\n  * implemented\n')
}

try {
  if (!cmd || cmd === 'help') {
    help()
  } else if (cmd === 'hygiene') {
    execFileSync('node', [join(STUDIO, 'gates', 'repo-hygiene.mjs'), ...(flag('publish') ? ['--publish'] : [])], { stdio: 'inherit' })
  } else if (cmd === 'prove') {
    execFileSync('node', [join(STUDIO, 'prove', 'gates.mjs')], { stdio: 'inherit' })
    execFileSync('node', [join(STUDIO, 'prove', 'rig.mjs')], { stdio: 'inherit' })
  } else if (cmd === 'engine') {
    /**
     * Git, aimed at the ENGINE repository.
     *
     * Two repositories share this working tree. The host project's is the
     * one `git` finds by walking up, and it tracks everything. The
     * engine's git directory sits outside the tree - which is what stops
     * the host recording a gitlink instead of files - so every command
     * aimed at it needs --git-dir, and a two-repo arrangement that only
     * works if somebody remembers a path is an arrangement that stops
     * working the week after it is set up.
     *
     * Raw argv, not the parsed flags: git's own flags are git's.
     */
    const { env } = await import('./lib/env.mjs')
    const dir = env().STUDIO_ENGINE_GIT
    if (!dir) die(new Error('STUDIO_ENGINE_GIT is not set in .env - it is the engine repo\'s git directory.'))
    const args = process.argv.slice(3)
    if (!args.length) die(new Error('Usage: node run.mjs engine <git args>\ne.g. node run.mjs engine status'))
    try {
      execFileSync('git', ['--git-dir=' + dir, ...args], { cwd: STUDIO, stdio: 'inherit' })
    } catch (e) {
      process.exitCode = e.status ?? 1
      throw DIED
    }
  } else if (cmd === 'bible') {
    const { bibleSheet } = await import('./stages/bible-sheet.mjs')
    await bibleSheet()
  } else if (cmd === 'models') {
    const { listModels } = await import('./lib/gemini.mjs')
    const models = await listModels({ refresh: !!flag('refresh') })
    for (const m of models) {
      if (!(m.supportedGenerationMethods || []).includes('generateContent')) continue
      console.log(m.name.replace(/^models\//, '').padEnd(44), (m.description || '').slice(0, 70))
    }
  } else if (cmd === 'status') {
    if (!existsSync(PRODUCTIONS)) process.exit(0)
    const dirs = readdirSync(PRODUCTIONS, { withFileTypes: true }).filter((d) => d.isDirectory())
    if (!dirs.length) console.log('No productions yet. Start one: node run.mjs new <slug>')
    for (const d of dirs) {
      const p = join(PRODUCTIONS, d.name)
      const reached = []
      if (existsSync(join(p, 'brief.md'))) {
        const approved = /^STATUS:\s*approved\b/mi.test(readFileSync(join(p, 'brief.md'), 'utf8'))
        reached.push(approved ? 'brief*' : 'brief')
      }
      if (existsSync(join(p, 'spec.json'))) reached.push('spec')
      const raw = existsSync(join(p, 'raw')) ? readdirSync(join(p, 'raw')).length : 0
      if (raw) reached.push(`generate(${raw})`)
      const reports = existsSync(join(p, 'reports')) ? readdirSync(join(p, 'reports')).filter((f) => f.endsWith('.json')).length : 0
      if (reports) reached.push(`validate(r${reports})`)
      if (existsSync(join(p, 'select.json'))) reached.push('select')
      const cutN = existsSync(join(p, 'cut')) ? readdirSync(join(p, 'cut')).filter((f) => f.endsWith('.webp')).length : 0
      if (cutN) reached.push(`cut(${cutN})`)
      console.log(`${d.name.padEnd(38)} ${reached.length ? reached.join(' > ') : 'empty'}`)
    }
    console.log('\n  * approved')
  } else if (cmd === 'new') {
    const slug = positional[0]
    if (!slug) die(new Error('Usage: node run.mjs new <slug>'))
    const dir = join(PRODUCTIONS, `${today()}-${slug}`)
    if (existsSync(dir)) die(new Error(`${dir} already exists.`))
    for (const sub of ['raw', 'reports', 'cut', 'rig', 'renders']) mkdirSync(join(dir, sub), { recursive: true })
    writeFileSync(
      join(dir, 'brief.md'),
      `# ${slug}\n\nSTATUS: draft - not approved\n\n## Intent\n\nWhat this production is for, in one paragraph.\n\n## Assets\n\n- name: what it is, where it is used\n\n## References\n\nWhich bible entries and canon characters govern this.\n\n## Acceptance\n\nWhat "done" means, concretely enough to argue about.\n\n## Budget\n\nCredit cap for this production: 12\n\n## Approval\n\nApproved by:            on:\n`,
    )
    console.log(`Created ${dir}\nWrite the brief, get it approved, then run the spec stage.`)
  } else if (cmd === 'approve') {
    const { approveBrief } = await import('./lib/brief.mjs')
    const dir = production(positional[0])
    const by = flag('by')
    if (typeof by !== 'string' || !by.trim()) {
      die(new Error('Who approved it? node run.mjs approve <prod> --by "<name>"\nAn approval with nobody\'s name on it is a checkbox.'))
    }
    console.log('Approved: ' + approveBrief(dir, by, today()))
  } else if (cmd === 'spec') {
    const { spec } = await import('./stages/spec.mjs')
    const r = await spec(production(positional[0]), { candidates: Number(flag('candidates', 3)) })
    console.log(`${r.file}\n${r.assets} assets, ${r.candidates} candidates each. Prompts assembled from the bible.`)
  } else if (cmd === 'generate') {
    const { generate } = await import('./stages/generate.mjs')
    const r = await generate(production(positional[0]), {
      only: list(flag('only')),
      n: flag('n') ? Number(flag('n')) : undefined,
      force: !!flag('force'),
    })
    console.log(`${r.made.length} new candidates. Spend ${r.spent}/${r.cap}.`)
  } else if (cmd === 'validate') {
    const { validate } = await import('./stages/validate.mjs')
    const out = await validate(production(positional[0]), { vision: !!flag('vision'), only: list(flag('only')) })
    const kept = out.assets.reduce((n, a) => n + a.survivors.length, 0)
    const all = out.assets.reduce((n, a) => n + a.candidates.length, 0)
    console.log(`Round ${out.round}: ${kept} of ${all} candidates survived. reports/round-${out.round}.md`)
  } else if (cmd === 'sheet') {
    const { sheet } = await import('./stages/select.mjs')
    await sheet(production(positional[0]), { only: list(flag('only')) })
  } else if (cmd === 'pick') {
    const { pick } = await import('./stages/select.mjs')
    const dir = production(positional[0])
    const choices = Object.fromEntries(
      positional.slice(1).map((p) => {
        const i = p.indexOf('=')
        if (i < 0) throw new Error(`Expected <asset>=<candidate>, got "${p}"`)
        return [p.slice(0, i), p.slice(i + 1)]
      }),
    )
    if (!Object.keys(choices).length) die(new Error('Usage: node run.mjs pick <prod> <asset>=<candidate> [...]'))
    pick(dir, choices)
  } else if (cmd === 'cut') {
    const { cut } = await import('./stages/cut.mjs')
    await cut(production(positional[0]), { only: list(flag('only')) })
  } else if (cmd === 'canon') {
    const { promote } = await import('./stages/rig.mjs')
    const name = positional[0]
    const from = flag('from')
    if (!name || typeof from !== 'string') {
      die(new Error('Usage: node run.mjs canon <name> --from <production>/<asset>\ne.g. node run.mjs canon fox --from fox-canon/fox'))
    }
    const [prod, asset] = String(from).split('/')
    promote(name, join(production(prod), 'cut', asset + '.webp'))
  } else if (cmd === 'rig') {
    const { rig } = await import('./stages/rig.mjs')
    const r = await rig(positional[0])
    console.log(`${r.file}
${r.parts} parts, ${(r.share * 100).toFixed(0)}% of the subject accounted for.`)
  } else if (cmd === 'check') {
    const { checkMotion } = await import('./stages/check-motion.mjs')
    const r = await checkMotion(positional[0], { clip: flag('clip') })
    console.log(r.pass ? '\nEvery clip passes.' : '\nSome clips do not pass - see above.')
    if (!r.pass) process.exitCode = 1
  } else if (cmd === 'strip') {
    const { renderStrip } = await import('./stages/render.mjs')
    await renderStrip(positional[0], { clip: flag('clip'), frames: Number(flag('frames', 6)), scale: Number(flag('scale', 0.5)) })
  } else if (cmd === 'poses') {
    const { renderPoses } = await import('./stages/render.mjs')
    await renderPoses(positional[0], { scale: Number(flag('scale', 0.5)) })
  } else if (cmd === 'frames') {
    const { renderFrames } = await import('./stages/render.mjs')
    await renderFrames(positional[0], {
      clip: flag('clip'),
      fps: Number(flag('fps', 30)),
      seconds: flag('seconds') ? Number(flag('seconds')) : undefined,
      scale: Number(flag('scale', 1)),
      video: !!flag('video'),
    })
  } else if (cmd === 'deliver') {
    deliver(production(positional[0]))
  } else if (STAGES.some(([s]) => s === cmd)) {
    console.error(`\nThe ${cmd} stage is not built yet. node run.mjs help shows what is.\n`)
    process.exit(1)
  } else {
    die(new Error(`Unknown command "${cmd}". Try: node run.mjs help`))
  }
} catch (e) {
  // DIED has already printed its reason; anything else has not.
  if (e !== DIED) {
    console.error('\n' + (e instanceof Error ? e.message : String(e)) + '\n')
    process.exitCode = 1
  }
}

/**
 * DELIVER - the one step that writes outside the studio.
 *
 * It is deliberately blunt about that. Delivery needs --yes because it
 * overwrites files in somebody else's repository, and it needs a budget
 * because a sprite set that quietly triples in weight is a performance
 * regression that arrives dressed as art.
 */
function deliver(dir) {
  const cutDir = join(dir, 'cut')
  if (!existsSync(cutDir)) throw new Error('Nothing has been cut yet.')
  const files = readdirSync(cutDir).filter((f) => f.endsWith('.webp'))
  if (!files.length) throw new Error('cut/ holds no sprites.')
  const kb = files.reduce((t, f) => t + statSync(join(cutDir, f)).size / 1024, 0)
  const budget = Number(flag('budget', 0)) || null
  const to = flag('to') === undefined || flag('to') === true ? deliverTo() : join(STUDIO, String(flag('to')))

  console.log(`${files.length} sprites, ${kb.toFixed(1)} KB total`)
  console.log(`destination: ${to}`)
  if (budget && kb > budget) {
    throw new Error(`Over budget: ${kb.toFixed(1)} KB against ${budget} KB.\nRe-cut smaller, or raise the budget deliberately.`)
  }
  if (!flag('yes')) {
    console.log('\nNothing copied. This writes into another repository, so it wants --yes.\n')
    return
  }
  ensure(to)
  for (const f of files) copyFileSync(join(cutDir, f), join(to, f))
  const manifest = join(cutDir, 'manifest.json')
  if (existsSync(manifest)) copyFileSync(manifest, join(to, `${basename(dir)}.manifest.json`))
  console.log(`Delivered ${files.length} sprites to ${to}`)
}
