# bible/ - the style bible (personalisation, not tracked)

One project's visual language lives here and is git-ignored. The engine
reads it; it never ships with it. Point the engine at a different bible
and it produces a different world.

    bible/
      style.json     the whole language: idiom, palette, light, texture,
                     edges, bans, key colours, references, gate thresholds
      refs/          the canonical reference images, attached to every
                     generation programmatically

`style.example.json` documents the schema and is the only file in here
that is committed.

## What each field does, and where it is enforced

| field | read by | what it decides |
|---|---|---|
| `idiom` | prompt assembly, vision gate | the sentence every prompt opens with |
| `palette` | prompt assembly, `palette-conform` | the colours the world may use, by role |
| `light` | prompt assembly | direction and quality, as one clause |
| `texture`, `edges` | prompt assembly, vision gate | how surfaces and boundaries are finished |
| `bans` | prompt assembly, vision gate | what never appears; the vision gate re-checks these |
| `keyColour`, `darkKeyColour` | prompt assembly, every keying gate, `cut` | the background a subject is generated on |
| `references` | `generate`, `validate --vision` | images attached to every request, relative to this folder |
| `visionFloor` | `validate --vision` | the score below which a candidate is dropped |
| `gates` | every gate | per-project threshold overrides, by gate id |

The palette is the field worth being slow about. It is measured against,
so a colour that is missing from it will be reported as drift in every
picture that uses it - and a palette padded with colours the world does
not really use makes the gate stop meaning anything.

## Changing it is itself a production

The bible is the reason two assets made six weeks apart look related.
Editing it changes every future picture, so it gets a brief and an
approval like anything else, and the old values stay in the diff.
