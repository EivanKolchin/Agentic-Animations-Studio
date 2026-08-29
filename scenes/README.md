# scenes/ - compositions (personalisation, not tracked by the engine)

A scene places rigs and backdrops in ONE world and declares the
rectangles that are cut out of it. That is the whole idea:

    world  ->  composed once per instant
      |
      +--> frame "wide"      crop  ->  1920x1080
      +--> frame "vertical"  crop  ->  1080x1920

Two outputs are two rectangles of the same pixels. They cannot drift
apart, cannot be re-timed differently, and cannot have one fixed without
the other - which is what "social is a delivery target, not a second
system" actually has to mean to be true.

    scenes/
      <name>.json     the composition
      renders/        strips, posters, frame stacks, video

## A layer

    { "id": "fox", "rig": "fox", "clip": "idle",
      "at": [780, 1520], "anchor": "bottom", "scale": 0.55,
      "z": 4, "keep": true, "phase": 0 }

`rig` + `clip` animate from the canon; `image` places a still instead.
`anchor: "bottom"` puts `at` under the middle of the bottom edge, because
anything standing on ground is at a SPOT on the ground - scaling it must
not move that spot. `phase` offsets one copy of a thing from another, so
two plants do not sway in lockstep. `keep` is a promise the scene-crop
gate then enforces: this layer must survive every frame's crop, at every
instant.

## The one thing that goes wrong

A 9:16 window taken out of a wide world is narrow, and the classic way
social repurposing fails is that the subject is half outside it. Nobody
notices from the wide version, which is the one that gets looked at, and
a still at t=0 will not show it either - a tail that swings can be inside
the frame at rest and clipped a second later. So `keep` is measured
across the clip rather than checked once.
