# Reviewing `@variance-authority/reads`

`reads()` names, on the element that shows it, the repository-relative files a
page showed, as one attribute `@variance-authority/route-collector` reads back.
It ships in the user's production code and calls nothing.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/reads/`.

## Contracts

- **One spelling for one set of files.** The attribute holds each path once, in
  code-unit order, space-separated, whatever order or nesting the caller named
  them in. Written in [README](README.md#what-it-returns) and pinned by
  [index.test.ts](src/index.test.ts) › "names each file once, in code-unit
  order, on the attribute a page run reads".
- **Nothing named, nothing claimed.** No argument, or only `undefined`, returns
  `{}`, never an empty attribute. Pinned by [index.test.ts](src/index.test.ts) ›
  "spreads nothing when it was handed nothing to name".
- **A path the attribute cannot carry throws.** An empty path or one holding
  whitespace is a `TypeError`, never split into files nobody showed. Pinned by
  [index.test.ts](src/index.test.ts) › "refuses a path the attribute could not
  carry".
- **Safe in production.** No dependencies, no peers, no environment read and no
  side effect. Written in [README](README.md#requirements).

## Not this package's

- Reading the attribute, digesting the file and selecting the page:
  `@variance-authority/route-collector` and `@variance-authority/sense`.
