---
'@variance-authority/cli': patch
'@variance-authority/store': patch
---

`share.token` is read from its environment variable when a share command reads it, not when the config loads. A job without that variable still loads the config and runs, and `variance share`, `variance ask` and `variance serve` report the share as unconfigured, naming the field and the variable. When no mainline is known and a run's branch was written to its own line for that reason, `variance share --publish` says so and names the answers that were missing; a pull request's line is its head branch either way, and it says nothing of the mainline. When it writes the report, it also says how many images the report names that this machine could not read, and names the first. `createDirectoryLineCell` answers an entry or image path that resolves outside its root as `refused`, from `store` and from `blob`, and the detail names the path.
