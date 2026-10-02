---
"@variance-authority/cli": patch
---

`variance journeys <shard.bin>... --suite <name>` lands the shards in a repository whose root `variance.config.json` declares its suites and configures no visual project. It used to stop on ``variance.config.json: `profile` must be a string``. Under `--suite` the command reads the root config only, the way `share --suite` does, and reads the suite's whole record, because no report names subjects to narrow it to. The pool line says so. `--config` next to `--suite` is refused.
