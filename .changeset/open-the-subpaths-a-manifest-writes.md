---
'@variance-authority/package': patch
---

Open an `exports` subpath written as a bare path or with its `types` nested
under `import`/`require`. Only a top-level `types` condition was read, so a
workspace using either of the two commonest shapes was reported as publishing
packages that open no names at all — an empty `help-index.md`, an
`llms.txt` of bare headings, and a `help-gaps.md` claiming every name carried a
doc block.
