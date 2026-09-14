# @variance-authority/package

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

### Patch Changes

- d956ba1: Open an `exports` subpath written as a bare path or with its `types` nested
  under `import`/`require`. Only a top-level `types` condition was read, so a
  workspace using either of the two commonest shapes was reported as publishing
  packages that open no names at all — an empty `help-index.md`, an
  `llms.txt` of bare headings, and a `help-gaps.md` claiming every name carried a
  doc block.
