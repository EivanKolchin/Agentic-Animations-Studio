/**
 * THE HYGIENE GATE.
 *
 * TWO REPOSITORIES SHARE THIS WORKING TREE, and that is why the gate has
 * two jobs rather than one.
 *
 * The HOST project's repo tracks everything, art included: the bible, the
 * canon and the productions are the work, and the work is worth a
 * history. The ENGINE repo publishes a style-agnostic system and must
 * carry none of that - somebody else's palette in a public engine repo is
 * somebody else's art in your repo.
 *
 * They coexist because the engine's git directory lives OUTSIDE the tree.
 * A `.git` inside studio/ would make the host record a gitlink instead of
 * files, and the host is meant to track the files.
 *
 * So the two jobs, and only the first is always true:
 *
 *   default    NO SECRETS. Nothing key-shaped in a tracked file,
 *              anywhere in the repository. Run before every push. This
 *              matters more than it did, not less: the key now sits in a
 *              working tree whose repo is actually pushed somewhere, and
 *              a credential in a history cannot be removed cleanly.
 *
 *   --publish  THE ENGINE/ART SPLIT, audited against the ENGINE repo's
 *              own index. It fails if anything under bible/, canon/ or
 *              productions/ is in it beyond the READMEs and examples that
 *              document their schemas - which is exactly right for a
 *              public engine repo and exactly wrong for the host's.
 *
 * Deliberately paranoid either way: a false alarm costs a second, a leak
 * costs the repository.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../lib/env.mjs'

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLISH = process.argv.includes('--publish')
const problems = []

function git(args, cwd) {
  return execFileSync('git', args, { encoding: 'utf8', cwd }).trim()
}

let root
try {
  root = git(['rev-parse', '--show-toplevel'], STUDIO)
} catch {
  console.log('Not a git repository yet - nothing to audit.')
  process.exit(0)
}

/**
 * Which repository is being audited.
 *
 * There are two, sharing one working tree. The host project's repo tracks
 * everything, including the art; the ENGINE repo keeps its git directory
 * outside the tree entirely - which is what stops the host seeing a
 * nested repo and recording a gitlink instead of files - and excludes the
 * art through its own info/exclude.
 *
 * So --publish has to ask the engine's index what it holds, not the
 * host's. Auditing the host and calling it a publish check would pass
 * every time and mean nothing.
 */
let files
if (PUBLISH) {
  const dir = env().STUDIO_ENGINE_GIT
  if (!dir) {
    console.error(
      '\n--publish audits the ENGINE repository, and STUDIO_ENGINE_GIT is not set.\n' +
        'Point it at that repo\'s git directory in .env - it lives outside this working\n' +
        'tree on purpose, so the host project sees plain files rather than a submodule.\n',
    )
    process.exit(1)
  }
  files = git(['--git-dir=' + dir, 'ls-files'], STUDIO)
    .split('\n')
    .filter(Boolean)
    .map((f) => ({ name: f, path: resolve(STUDIO, f) }))
} else {
  files = git(['ls-files'], root)
    .split('\n')
    .filter(Boolean)
    .map((f) => ({ name: f, path: resolve(root, f) }))
}

/** The studio's own subset, as paths relative to studio/. */
const mine = files
  .filter((f) => !relative(STUDIO, f.path).startsWith('..'))
  .map((f) => ({ ...f, inStudio: relative(STUDIO, f.path).split('\\').join('/') }))

/* ---- always: no secrets, anywhere ---- */

for (const f of files) {
  if (/(^|\/)\.env($|\.)/.test(f.name) && !f.name.endsWith('.env.example')) {
    problems.push(`${f.name} is an env file and must never be tracked.`)
  }
  if (/\.key$|credentials.*\.json$/.test(f.name)) {
    problems.push(`${f.name} looks like a credential file and must never be tracked.`)
  }
}

// Two Google key shapes, because there are two in the wild: the
// long-running `AIza...` and the newer `AQ.` form, which is longer and
// contains dots. The value charset has to allow the dot, or the
// GEMINI_API_KEY rule stops at the first one and matches nothing - which
// is how this gate read a file containing a live key and passed it, on
// the day the key arrived. Proved by staging the real .env and watching
// it fail, which is the only way to know a pattern matches the thing it
// was written for.
const KEY_SHAPES = [
  { re: /AIza[0-9A-Za-z_-]{30,}/, what: 'a Google API key' },
  { re: /\bAQ\.[A-Za-z0-9_.-]{24,}/, what: 'a Google API key (AQ. form)' },
  { re: /sk-[A-Za-z0-9]{20,}/, what: 'an OpenAI-style key' },
  { re: /\bGEMINI_API_KEY\s*[=:]\s*["']?[A-Za-z0-9_.-]{10,}/, what: 'a filled-in GEMINI_API_KEY' },
]
// Binary and very large files are skipped: a key is text, and reading a
// two-megabyte PNG to look for one is how a gate becomes a gate nobody
// runs.
const SKIP = /\.(png|jpe?g|jfif|webp|gif|mp4|webm|woff2?|ttf|otf|ico|zip|pdf|jar|keystore|so|dll|exe|node)$/i
let scanned = 0
for (const f of files) {
  if (SKIP.test(f.name)) continue
  let size = 0
  try {
    size = statSync(f.path).size
  } catch {
    continue
  }
  if (size > 2_000_000) continue
  let text = ''
  try {
    text = readFileSync(f.path, 'utf8')
  } catch {
    continue
  }
  scanned++
  for (const { re, what } of KEY_SHAPES) {
    if (re.test(text)) problems.push(`${f.name} contains what looks like ${what}. Remove it before committing.`)
  }
}

/* ---- --publish only: the engine/art split ---- */

if (PUBLISH) {
  const PERSONAL = ['bible/', 'canon/', 'productions/']
  const ALLOWED = /(^|\/)(README\.md|\.gitignore)$|\.example\.(json|md)$/
  for (const f of mine) {
    if (PERSONAL.some((p) => f.inStudio.startsWith(p)) && !ALLOWED.test(f.inStudio)) {
      problems.push(
        `${f.name} is personalisation. A published ENGINE ships without a project's ` +
          `bible, canon or productions - split the subtree and drop these, or keep them ` +
          `and accept that what you are publishing is this project's art.`,
      )
    }
  }
}

if (problems.length) {
  console.error(`\nHygiene gate FAILED (${problems.length}):\n`)
  for (const p of problems) console.error('  - ' + p)
  console.error(
    '\nNothing has been changed. Unstage the offending files (git rm --cached <file>),' +
      '\nconfirm .gitignore covers them, and run again.\n',
  )
  process.exit(1)
}

console.log(
  PUBLISH
    ? `Hygiene gate OK (publish) - ${mine.length} studio files, no personalisation, no secrets in ${scanned} tracked text files.`
    : `Hygiene gate OK - no secrets in ${scanned} tracked text files (${files.length} tracked, ${mine.length} in studio/).`,
)
