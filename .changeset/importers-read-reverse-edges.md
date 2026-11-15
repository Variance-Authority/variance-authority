---
'@variance-authority/sense': patch
---

`variance ask symbol` and `ask uses` find the files importing a name from the
imports `variance index` recorded backwards, by the file they import, rather
than by reading every file's imports on every step of the walk; indexing takes
as long as before. An index written by an earlier version is built again on
first use.
