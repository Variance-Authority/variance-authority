---
'@variance-authority/help': minor
'@variance-authority/sense': minor
---

`ask grep`, `docs_grep` and `discover --text` answer with no `rg` on PATH

They ran the `rg` binary over the files a start point reaches, and a machine without it got an instruction to install ripgrep instead of an answer. The search now runs inside the native addon on ripgrep's own crates, so the pattern language, the BOM-sniffed encodings and the binary rules are ripgrep's as before. A ripgrep config file named by `RIPGREP_CONFIG_PATH` no longer applies, and a line that is not UTF-8 shows its text with replacement characters rather than `(not UTF-8)`.

`ripgrepNative(root, pattern, files)` returns the matching lines of the files, as columns, in the order the files were given, and one complaint per file it could not read.
