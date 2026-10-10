---
'@variance-authority/cli': patch
---

`covering` no longer offers a different file that shares the name as the one you asked about

When the file you asked about is not in the record, `covering` points at the
recorded spelling, because the usual cause is the right file under another
root. It used to point at any recorded file with the same name, so
`packages/core/src/format/stabilize.ts` was answered with "The record spells it
`packages/dom/src/stabilize.ts`", a different module, which reads as a stale
record. The sentence now names a recorded path as the spelling only when it is
in `spelled`: one of the two paths ends in the other with a directory in common.
One that shares only the file name is named as sharing it. The same holds for a
`--cases` test file.

The refusal also names the second reason a file has no row: the run loaded it
but did not instrument it, such as a module your suite's `include` leaves out.
