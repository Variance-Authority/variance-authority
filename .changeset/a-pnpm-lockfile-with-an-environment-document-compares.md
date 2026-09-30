---
"@variance-authority/sense": patch
---

A `pnpm-lock.yaml` that opens on `---` compares its install

A pnpm that pins itself writes the lockfile as two YAML documents: the package manager and its configuration dependencies first, the install second. TanStack Query's lockfile has this shape. The reader refused it at line 1, so every lockfile change made `variance select` and `yarn test:since` run the whole suite. It now splits the file where pnpm does, reads both documents, and a bumped package selects the tests that entered a module importing it. A byte-order mark and CRLF line ends read the same as pnpm reads them. A refusal names the line in the file, not the line in the document.
