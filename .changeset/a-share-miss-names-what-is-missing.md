---
'@variance-authority/cli': patch
'@variance-authority/store': patch
---

`share.token` is read from its environment variable when a share command spends it, not when the config loads. A job without that variable still loads the config and runs, and `variance share`, `variance ask` and `variance serve` report the share as unconfigured, naming the field and the variable. `variance share --publish` says which answers were missing when no mainline is known, and that the run was written to its branch's line for that reason. When it carries the report, it also says how many images the report names that this machine could not read, and names the first. `createDirectoryLineCell` answers an entry or image path that resolves outside its root as `refused`, from `store` and from `blob`, and the detail names the path.
