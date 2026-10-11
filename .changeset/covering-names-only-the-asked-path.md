---
'@variance-authority/cli': patch
---

`covering` names only the path you asked about when the record does not hold it

When the file you asked about is not in the record, `covering` used to guess
which recorded file you meant and offer it as "the record spells it": any
recorded file with the same name, so `packages/core/src/format/stabilize.ts`
was answered with `packages/dom/src/stabilize.ts`, a different module. Two paths
are two files, so the refusal now names the asked path, the record it read and
nothing else, and says the record names files from the repository root. The
same holds for a `--cases` test file the index holds no case of. An absolute
`--file`, as an editor copies it, is now read from the root.
