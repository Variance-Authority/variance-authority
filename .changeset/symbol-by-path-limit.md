---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`ask symbol --name` lists at most `--limit` imports by path, 5 when not said, under each file they name and under each kind that reaches no declaration, where it listed every one. The rest are counted on one line that names the `ask uses --name <name>` question listing them, nearest to a file you name first, with `--file` and the declaring file where there is one. On a large monorepo, `ask symbol --name useKibana` answers in about 25 kB, where it took about 197 kB.
