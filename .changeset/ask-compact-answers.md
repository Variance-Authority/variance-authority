---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance ask discover`, `intersection`, `grep`, `uses` and `symbol` answer in fewer lines and say each fact once. Each answer opens with the answer: `673 files in all of them, nearest first:`, `15 matching lines in 4 files, nearest first:`. `discover` gives one row per file, with its import counts before the path; the chain tail every row shares is printed once as `chains end: …`. `grep` lines and `symbol`'s `Members:` share one grouping: a file with one line is `path:line: text`, and a file with several is its path, then `  line: text` under it. A `uses` row under a heading that already names its package or its file leaves the package off. A `symbol` local name whose declaration the answer already gave says so in one line instead of answering it again. Notes come on trailing `note:` lines, before the paging line and the snapshot.
