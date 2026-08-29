# Agentic Animations Studio

One system for producing highly-rendered illustrated assets and
animation: briefed in conversation, generated through the Gemini image
API, validated by gates, rigged and animated in code, and delivered
either to a website or as social video.

It exists because the alternative is a fragmented workflow - prompts
pasted into one tool, files downloaded from another, consistency checked
by eye, and every lesson learned forgotten by the next session. Here the
pipeline is one command, every stage leaves files on disk, and every
failure that turns out to be systemic becomes a gate so it cannot happen
twice.

## The one rule: the engine knows no art

    ENGINE (style-agnostic)         PERSONALISATION (one project's own)
    ------------------------        --------------------------------
    stages/   the pipeline          bible/       the visual language
    gates/    the validators        canon/       the characters
    lib/      generation, keying,   productions/ briefs, raws, cuts,
              rigging, rendering                 renders
    run.mjs   the CLI               .env         the API key

The engine is style-agnostic on purpose: point it at a different bible
and it produces a different world. Nothing in `stages/`, `gates/`,
`lib/` or `run.mjs` names a colour, a character or a project.

That is a rule about DEPENDENCIES, not about repositories. The studio
lives inside its host project's repo and is tracked by it, because the
bible, the canon and the productions are the work and the work deserves
a history. Taking the engine out on its own later is
`git subtree split -P studio` plus `npm run hygiene --publish`, which
audits that the split carries no art and no key.

**The key is the one thing that never gets tracked.** `npm run hygiene`
sweeps every tracked text file in the repository for anything key-shaped
and fails on it. Run it before every push; it costs half a second, and
it has already caught a live key that the first version of its own
pattern missed.

## The pipeline

Each stage writes files and can be resumed. Approval points are
deliberately few - two by default - so the human steers without becoming
the bottleneck.

1. **Brief** - agreed in conversation, written to `brief.md`: intent,
   assets, acceptance criteria, credit cap. *Human approves*, by name,
   in the file.
2. **Spec** - decomposed into per-asset slots. Prompts are ASSEMBLED
   from the bible, never written freehand; that is what kills style
   drift at the source, and a spec carrying its own prompt is refused.
3. **Generate** - Gemini image generation with reference images
   attached programmatically. Several candidates per asset: selection
   beats re-rolling. Spend is counted against the brief's cap.
4. **Validate** - code first (background flatness, key collision, edge
   halo, palette conformance, sheet registration, framing), then vision
   models on the survivors for what code cannot judge - style adherence,
   off-model drift.
5. **Select** - survivors and failures together on one contact sheet,
   each failure labelled with what it failed; the choice is recorded.
6. **Cut** - key, despill, erode, slice, trim, resize, manifest.
7. **Rig and animate** - the canon cut into parts, each with a pivot and
   a parent; motion sampled from a deterministic clock rather than
   interpolated between keyframes, with follow-through as a time offset
   down a chain. Nothing is placed by hand: a part's rest position is
   derived from the box it was cut from.
8. **Validate motion** - the loop actually closes, the still frame is an
   honest one, and what is declared planted does not slide.
9. **Deliver** - sprites to a project's asset folder, or frames through
   ffmpeg to 16:9 and 9:16 video. *Human approves* - delivery writes into
   another repository, so it wants `--yes` and a size budget.
10. **Learn** - when a change request reveals a class of problem rather
    than a matter of taste, it becomes a gate, and that gate records the
    failure that created it. The loader refuses a gate that does not.

## Commands

    node run.mjs                                  the map
    node run.mjs new <slug>                       start a production
    node run.mjs status                           where every production is
    node run.mjs approve <prod> --by "<name>"     record a human approval
    node run.mjs spec <prod>                      scaffold and assemble prompts
    node run.mjs generate <prod> [--only=a,b] [--n=N] [--force]
    node run.mjs validate <prod> [--vision]
    node run.mjs sheet <prod>                     contact sheet of the last round
    node run.mjs pick <prod> fox=03               record a selection
    node run.mjs cut <prod>                       key, slice, trim, manifest
    node run.mjs canon <name> --from <prod>/<asset>  promote a cut to canon
    node run.mjs rig <name>                       cut the canon into parts
    node run.mjs check <name> [--clip=idle]       the motion gates
    node run.mjs strip <name> [--frames=6]        read the motion as a still
    node run.mjs poses <name>                     every declared pose, side by side
    node run.mjs frames <name> [--fps=30] [--video]
    node run.mjs deliver <prod> --yes [--budget=KB]
    node run.mjs models                           what the key can see
    node run.mjs prove                            break the pictures, watch the gates fire
    node run.mjs hygiene                          audit the engine/art split

## The gates

Six code gates run on every candidate, free and deterministic, before any
model is asked anything. Each one lives in `gates/` and each one has to
declare `because` - the specific failure that created it - or the loader
refuses to load it.

| gate | refuses |
|---|---|
| `background-flat` | a graded, vignetted or scenic background where a flat key was asked for |
| `key-collision` | the key colour inside the subject, which keying turns into holes |
| `edge-halo` | glow: contamination that does not decay within a pixel or two of the silhouette |
| `palette-conform` | colours the bible does not name, measured on the subject's interior |
| `sheet-registration` | a sheet cell that is empty, doubled, or whose subject crosses a gutter |
| `frame` | the wrong aspect, or a subject cropped by the edge of its own frame |

Three more run on motion, against a rig and a clip rather than a picture:

| gate | refuses |
|---|---|
| `motion-loop-seam` | a declared period that is not a true period of the channels under it |
| `motion-still-honesty` | a t=0 frame at the top of a swing, which is the frame every thumbnail uses |
| `motion-anchor-drift` | a planted part that slides because something above it turned |

`npm run prove` draws nine pictures, breaks eight of them in one specific
way each, and asserts that the targeted gate fails AND that no other gate
does. It then renders parts with markers at their own pivots and measures
where they actually landed - which checks the chain, the composite offset
and the rotation sign against the PICTURE rather than against the same
formula run twice - and puts five clips through the motion gates the same
way. A validator that has only ever been watched passing is not evidence
of anything: it passes when it is right and it passes when it is reading
the wrong array.

## What an asset declares

Gates ask questions no measurement can answer, so the spec answers them
once, in git, next to the subject:

| declaration | means |
|---|---|
| `key` | the background colour this asset is generated on |
| `bleed` | this asset IS the background: never keyed, never trimmed |
| `mayTouchEdge` | an ordinary keyed subject is allowed to reach the frame |
| `allowHoles` | the subject genuinely encloses background (a seed clock is lace) |
| `offPalette` | this asset is exempt from palette conformance |
| `sheet` | `{ cols, rows, cells, names }` - the grid it is generated on and sliced by |
| `cut` | `{ shrink, width, quality, fraction }` - how it becomes a sprite |

And what a clip declares:

| declaration | means |
|---|---|
| `period` | the length of one cycle; every channel frequency must divide it |
| `planted` | parts that must not move, whatever turns above them |
| `loop: false` | this is a continuous scene, not a loop - required if any channel uses noise |
| `lag`, `decay` | follow-through down a chain: the same motion, later and softer |

## Setup

    cp .env.example .env     # add your Google AI Studio key
    npm install
    npm run prove            # the gates, proved against their own defects
    npm run hygiene          # before every push

**Generation needs billing enabled**, and vision does not. A free-tier
key returns 429 with `limit: 0` for every image model - a closed door,
not a rate limit - while text and vision calls work normally. The client
tells the two apart and says so rather than backing off three times
against a quota that is zero.

`sharp` is the only dependency. The Gemini client is plain `fetch`
against three endpoints, and model names are discovered at runtime rather
than hardcoded - image model names move, and a constant in a file is a
system that breaks on somebody else's release schedule.

## Boundary

This studio is for high-render marketing and social assets. It is not
for in-product content that must be diagrammatically true - that belongs
to whatever gates the consuming project already has.
