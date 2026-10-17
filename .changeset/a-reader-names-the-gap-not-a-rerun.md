---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
'@variance-authority/mcp': patch
'@variance-authority/distill': patch
'@variance-authority/unit-test': patch
---

A refusal names what is missing instead of asking you to run the suite again

Running a whole suite again to refresh a record is rarely yours to do, so no
message tells you to. Where something can still be answered, it is:

- `variance_composition {subject}` against a report with no per-subject
  structure lists the components the census holds in that subject and the
  renderings it shares, and says the report holds no order, depth, mount or
  count within it.
- `variance_locate` with `under`, `above` or another spatial relation, against
  a run that resolved no layout, prints where the anchor is on each surface that
  says it, and says the run cannot tell what sits in that relation to it.
- `variance_composition` against a report merged from shards says each shard's
  report still holds its composition, and the suite index the build composes
  from every shard's part holds the census across them.

Where nothing can be answered, the refusal stays and names the condition, not a
rerun: shards that started from, or chose their tests from, different records
are not combined, and the record before the build stands; shards written by
another version, or of which only some kept cases, are not combined;
`variance shards --unrecorded 0` says a matrix of none starts no job; a Vitest
run whose `--reporter` replaced the recording reporter says the record is as it
was; a distill reading withheld for an incomplete coverage row, and a missing
unit-test capture directory, name what is missing.
