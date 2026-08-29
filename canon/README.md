# canon/ - the characters (personalisation, not tracked)

Each character is generated EXACTLY ONCE, in a neutral pose with limbs
separated, then cut into rig parts. Every later pose is the rig moving,
so the character is literally the same pixels every time and cannot
drift off-model.

Expected shape:

    canon/
      <name>/
        source.png     the one true generation
        parts/         cut pieces
        rig.json       pivots, parent chain, pose library
