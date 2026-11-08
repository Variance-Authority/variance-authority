---
'@variance-authority/cli': minor
---

`variance report` exits 2 before it merges when the reports it is given are not every shard of one `--shard` count, and names what is wrong: `these reports are not one build: shard 3/3 is missing.`, a shard given twice, or shards cut two ways. `comment`, `ask`, `adjudicate` and `share --publish` refuse alike, since they read shards the same way. The count comes from each shard's part beside its report, so no flag repeats it. `Variance-Authority/action` takes the shards' reports as `reports` and merges, posts one docket, publishes with `share --publish` and exits 0, 1 or 2 for the suite in one step.
