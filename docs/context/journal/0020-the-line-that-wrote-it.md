# 0020 — The line that wrote it

**Date:** 2026-08-13
**Question:** a report that names `Button` is one hop short. The instruction was
blunter than a question: *without connecting back to code we cannot do a lot, so
we connect — no matter what.*

## The claim this repository kept making, and why it was wrong

Since [0002](0002-fiber-provenance.md) this project has said, in four places,
that per-element source locations are gone on React 19. `docs/comparison.md` said
it, `checkpoint.md` said it, `packages/react/README.md` said it, and
`core/attribute/source.ts` opened with it. The measurement behind it was correct
— `_debugSource` really is absent on 19.2.8 — and the conclusion drawn from it
was not.

The correction came from outside: **this depends on transformer settings, and it
can be turned back on.** Probing it settles the argument in three lines.

esbuild, `--jsx=automatic --jsx-dev`, on `<span className="badge">{label}</span>`:

```js
jsxDEV("span", { className: "badge", children: label }, void 0, false,
  { fileName: ".../probe.jsx", lineNumber: 4, columnNumber: 10 }, this)
```

The location is right there, computed and passed, in every ordinary build. React
19 is what drops it, on both paths and deliberately:

- `exports.jsxDEV = function (type, config, maybeKey, isStaticChildren)` — four
  parameters. It calls its internal implementation with
  `Error("react-stack-top-frame")` in the fifth slot, overwriting whatever the
  transform sent.
- `createElement` copies `config` into props while skipping `__source` and
  `__self` **by name**, so the classic transform loses it too.

So nothing is missing from the build. One hop is missing from the runtime, and a
hop is a thing you can supply.

## What was built

`@variance-authority/jsx-source` — React's JSX runtime with one line added,
addressed by the compiler through the standard `jsxImportSource` setting. No
plugin, no fork, no patched React. It records the location on the props object
and hands the props to React unchanged: React still creates the element, still
owns it, still validates it, and `owners`/`createdBy` still come out of React's
own bookkeeping.

Three decisions carried the design.

**A symbol, not a property.** `Symbol.for('@variance-authority/jsx-source')` is
invisible to `for…in`, so `react-dom` never renders it as an attribute and a
component spreading `{...props}` onto a `<div>` does not put a file path in the
document. It is invisible to `Object.keys`, so it never enters `propsDigest` —
load-bearing, because a digest that moved when a line moved would make inserting
an import at the top of a file read as a change to every component below it.
`Symbol.for` rather than a module-level symbol because the writer is in the
page's bundle and the reader is in a page agent evaluated beside it: two module
graphs that will never share an import, and the global registry is the only place
they can meet.

**`key` had to be lifted out.** React rebuilds the props object when
`"key" in config`, and rebuilds it with `for…in` — which does not see symbols.
Left alone, every element in every list would have been the one kind that arrived
with no location. The runtime moves the key into the `maybeKey` argument first,
which puts React on its no-copy path.

**Locations are made relative once, in the collector.** A transform writes the
absolute path its module graph holds. A page has no idea what a repository root
is; the collector does, so `normalize` takes a `sourceRoot` and every recorded
location comes out repository-relative — matching what `SourceRef.file` has
always promised, and keeping a home directory out of a committed baseline. A path
compiled from outside the root is left absolute rather than turned into a chain
of `..`.

## Two mechanisms, and the difference between them is the point

The name scan in `core/attribute/source.ts` did not go away, and should not:
it needs no build change and it is what a repository that has configured nothing
still gets. But the two answer different questions, and the report now prefers
the exact one wherever it exists.

| | answers | for four `<Button>`s on one page |
|---|---|---|
| name scan (`indexSource`) | where `Button` is **declared** | one line, the same for all four |
| recorded location | where the element is **written** | four lines, one each |

Asserted end to end, against a production Storybook this project did not author:
`Button` is declared on line 51 of `src/ds.jsx` and its `<button>` is written on
53. The report says 53. The assertion derives both line numbers from the file
rather than hard-coding them, because the claim under test is *which of the two*
the report chose.

## What it cost

Two settings in `.storybook/main.js`, and they are opposite kinds of setting:

```js
keepNames: true,        // names do not survive minification
jsxDev: true,           // locations do — they are data the compiler wrote
jsxImportSource: '@variance-authority/jsx-source',
```

Measured on the minified production build: 68 recorded locations across two
files. `keepNames` exists because minification renames functions and a component
called `a` is worse than no name at all; `jsxDev` needs no such protection,
because a location is emitted as data rather than carried by an identifier.

Nothing stored moved. `provenance.source` is not hashed and not compared —
`compare-nodes.ts` whitelists `owners` and `createdBy`, and every attribute
module names the fields it projects — so the whole thing shipped without
invalidating a baseline.

## What is still open

- **Only React records.** The location is written by a JSX runtime, so a
  framework whose elements do not go through one gets the name scan and nothing
  more. That is the same vacancy [spec 0019](../../specs/0019-provenance-without-react.md)
  already names.
- **A dependency shipping pre-compiled JSX reports nothing**, because its
  elements were transformed by its own build. Its components still resolve by
  name if its source is scanned.
- **Nobody has run this over a repository with two roots** — a monorepo where the
  CLI's working directory and the compiled package's root differ. The relative
  path would then be correct and long rather than wrong, but it is untested.
