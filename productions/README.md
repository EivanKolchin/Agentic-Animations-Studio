# productions/ - the work (personalisation, not tracked)

One folder per production, named by date and slug. Everything a
production touches stays inside it, so it can be reviewed, resumed or
abandoned as a unit. Every file here is written by a stage; none of them
is a cache, and none of them is safe to delete on the grounds that it can
be regenerated - regenerating raw/ costs credits.

    productions/2026-08-16-fox-canon/
      brief.md       intent, assets, acceptance, credit cap, approval
      spec.json      per-asset slots plus the prompt assembled from them
      ledger.json    every generation, its model, and the spend against cap
      raw/           every candidate, kept - never silently discarded
      reports/       round-N.json and round-N.md, one pair per validation
      select.json    which candidate won, per asset
      cut/           keyed and sliced sprites, plus manifest.json
      rig/           rig json and pose data
      renders/       contact sheets, t-strips, video
      report.md      what happened, what was learned

## Why the losing candidates stay

A selection is an argument, and an argument you cannot reopen is a
decision nobody can check. Keeping the rejects means a choice can be
revisited, and it means a gate written next month can be run over what
was thrown away last month - which is how you find out whether the new
rule would have changed anything.

## The two files a human writes

`brief.md` before anything starts, and the slots in `spec.json`. Every
other file in here is produced by a stage, and hand-editing one is a
signal that a stage is missing a declaration it should be asking for.
