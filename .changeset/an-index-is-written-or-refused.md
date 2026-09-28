---
"@variance-authority/sense": patch
"@variance-authority/cli": patch
"@variance-authority/help": patch
---

`variance index` exits `2` with `source index not written: <reason>, at <path>` when the file system refuses the index, instead of reporting it built. `updateSourceIndex` returns the refusal as `refused`; a scan anywhere else still treats an unwritable cache as a cold next run. A `variance ask` question no longer narrows the source index it reads: a workspace whose path runs through a link, such as a checkout under macOS's `/var`, is scanned whole, and a scan of only some of a repository's directories publishes its answer without writing over the index of the whole. Before, either one could leave `variance select` unable to trace a lockfile bump to the tests it reaches.
