---
'@variance-authority/sense': patch
---

`ask uses` lists the lines of a file whose every declaration is exported

A TypeScript or JavaScript file whose top-level statements were all `export
function` or `export const` recorded no lines that use its names, so `ask uses`
listed nothing under `Used in the file that declares it` for it, and listed
every line once the file kept one name to itself. The scan now asks the same
walk of the file's top-level names that its symbols are read from, so an
exported declaration counts as one.

The source index format moves to version 30, so the first scan after the
upgrade reads every file again.
