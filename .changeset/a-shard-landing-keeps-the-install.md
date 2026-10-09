---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

Shards landed with `variance journeys <shard>...` keep the install they ran on

Each shard's seam keeps the lockfiles and manifests that differed from its
commit in the runs record beside its snapshot. The landing kept none of that,
so `variance select` after it compared the install from the commit. A bump the
shards had already run on, not yet committed, read as moved, and every test
that loaded the package ran again. Now the landing reads each shard's
`coverage.runs.json` and records the install they all name. A shard whose runs
record is missing, does not name its snapshot's commit, or did not observe
every test its snapshot holds names no install, and neither do shards that ran
on different installs: the landing then keeps none, and a later selection
compares from the commit. `@variance-authority/sense` exports `shardsInstall`,
the rule the landing reads them by.
