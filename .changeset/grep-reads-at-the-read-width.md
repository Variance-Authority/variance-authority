---
'@variance-authority/sense': patch
---

`ask grep` and `ask discover` search their files at the read width, not on every core

The search behind `ask grep --from/--to` and `ask discover` opened its files on every core of the machine. Opening a file costs the kernel more the more threads open files at once, so it now opens them with the same few threads `variance index` reads with. The answer is unchanged, line for line. On Kibana, a search over the 14,686 files one start point reaches spends about a third of the kernel time it did.
