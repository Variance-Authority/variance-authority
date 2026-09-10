---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

Fold shard snapshots into the one a checkout reads.

A suite split across CI jobs recorded one execution snapshot per job, and
nothing shipped could make them one: `mergeCoverage` was reachable only through
the Vitest seam, layers rather than folds, and no writer was public at all. The
README said a job combines shards with it, and no job could.

`@variance-authority/sense/test-selection` now exports `foldTestCoverage`, the
order-independent union of shards that refuses by name when two were not one
run, `writeTestCoverage`, the whole-or-nothing writer every seam lands through,
and `mergeCoverage` itself. `variance journeys` takes shard snapshots as
positionals, folds them, layers the result over what this checkout already
holds — or writes it where `--into` says — and reads the suite it just made.
