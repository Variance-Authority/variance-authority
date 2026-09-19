# ADR-0066 — a language is a reader, not a Sense of its own

**Status:** accepted
**Date:** 2026-09-19

## Context

`sense` opens eight module extensions and four stylesheet extensions. Every
repository it is pointed at that is not entirely JavaScript therefore returns a
graph with a hole in it, and a hole is the direction [`read.ts`](../../../packages/sense/src/read.ts)
exists to refuse: a file whose outgoing edges cannot be enumerated must say so,
because under-reporting an edge produces a wrong answer rather than a smaller
one. Today those files are not recorded at all, which is the same wrongness
arriving by omission.

Three checkouts, counted from the git index:

| repository | the other half | the JavaScript half |
|---|---|---|
| `shadow` | 583 `.swift` | 274 `.ts` / `.tsx` |
| `briefcase` | 299 `.py` | 644 `.ts` / `.tsx` |
| this one | 14 `.rs` | the rest |

Two of those are majority-not-JavaScript. A scan of `shadow` answers *what does
this change reach* over a quarter of the repository and is silent about the rest.

Tree-sitter is the common answer in this space, and the question is how much of
it to take.

## Decision

### 1. `oxc` stays for JavaScript and TypeScript. Tree-sitter reads everything else.

1,080 files and 8.6 MB of this repository's own TypeScript, on
[the measurement machine](../checkpoint.md):

| | wall | throughput | what it produced |
|---|---|---|---|
| `oxc` | 93 ms | 92.8 MB/s | tree **and** ES module record — 4,251 static imports |
| tree-sitter (`web-tree-sitter` 0.25.10, `typescript`) | 671 ms | 12.8 MB/s | the tree, nothing extracted |

7.2×, and the comparison is already generous to tree-sitter: `oxc`'s column
includes the module record, and tree-sitter's includes no extraction at all. A
tree-sitter TypeScript reader has to add a query pass on top of that 671 ms, and
what it would rebuild by query is exactly what `oxc` hands over already computed
and already spec-correct — the imported, local and exported name of every
binding, `import { type x }` separately from `import type { x }`, and an export
set that knows `export * from './x'` is an unknown set rather than an empty one.

Resolution says the same thing twice. `oxc-resolver` already answers `tsconfig`
paths, export conditions and extension order, and the native scanner is built on
the `oxc` crates ([ADR-0065](0065-source-scanning-is-one-native-side.md)).
Replacing that path buys one property — every language read the same way — and
costs a seven-fold scan on the language every repository here has most of.

The gate this clears: a uniformity argument does not reopen it. A measurement
inside 2× would.

### 2. One `sense`, one record space, one graph.

A request is a specifier and a binding is a name, and neither is a JavaScript
fact. `Read` is already the proof: the stylesheet reader produces that same shape
out of completely different syntax and shares no AST with the module reader. A
language is therefore a `(reader, resolver)` pair keyed by extension, and nothing
above [`record.ts`](../../../packages/sense/src/record.ts) learns a new type.

The case that would force separation — a Python file and a Swift file never
resolve to one another — does not force it, because they do not have to. They
land in one `FileRecord` set whose edges happen never to cross, and a graph with
two disconnected components is still one graph: every question `sense` answers
walks edges and none of them asks what language it is standing in. Two `sense`s
would duplicate the digest cache, the git tree snapshot, the record cache, the
source index and the resolution witnesses in order to express a disconnection the
data expresses for free.

The edges that genuinely do cross a language boundary — a `.swift` and a `.ts`
joined through a build step, a Python service and its generated TypeScript client
— are not import edges in either language. They are out of scope here and they
are not an argument for separation, because separating the record spaces makes
them harder to hold rather than easier.

### 3. Swift has no file-grain import edge, and `sense` reports the grain it has.

`shadow`: 583 Swift files, 1,389 `import` statements, and **every one of them
names a module** — `import Foundation` 392 times, `import Core` 256, `import
XCTest` 196. Not one names a file. Swift has no file-level import, because a
target compiles as a unit and every file in it sees every other with nothing
written between them.

So the strongest edge Swift syntax supports is file → target → target, read from
`Package.swift`. That is package grain: a change to any file in `Core` reaches all
256 files that import `Core`. It over-reports, which is the safe direction, and it
is the same grain `swift build` itself recompiles at.

Below module grain the only join available is nominal — this file declares
`struct Recorder`, that file writes `Recorder`. That is admissible here only
under one rule: a name resolves to **every** file declaring it, never to the best
candidate. Resolving to one widens nothing and can narrow, and narrowing on a
guess is the failure this package is built around. It is a refinement, it is
specified separately, and it is not in the first increment.

Python and Rust are not Swift. `briefcase`: 2,010 import statements, 1,017
dotted-absolute and 59 relative, 624 of them under the first-party root
`briefcase` — each resolves to a path the way a JavaScript specifier does. Rust's
file edge is `mod foo;`, and `use crate::a::b` resolves through the module tree
that `mod` declarations build.

### 4. The grammars are WASM on the JavaScript side.

[ADR-0065](0065-source-scanning-is-one-native-side.md) holds the TypeScript
implementation as the oracle and admits no configuration in which the native
binary's absence changes an answer. A Rust-only tree-sitter would break that
rule rather than bend it: a Python edge that exists only when a prebuilt `.node`
loaded is a *different* graph, not a slower one.

So each grammar is supplied twice from one source — as WASM to `web-tree-sitter`
on the JavaScript side, and compiled into the native crate — and the differential
tests compare the two the way they already compare the two `oxc` paths.

What that weighs, and what it costs to run on the corpora it is for:

| | grammar | files | wall | throughput |
|---|---|---|---|---|
| Swift (`shadow`) | 3.1 MB | 583 | 1,795 ms | 3.1 MB/s |
| Python (`briefcase`) | 476 KB | 299 | 258 ms | 13.1 MB/s |
| Rust (here) | 819 KB | 14 | — | — |

Plus a 4.7 MB `web-tree-sitter` runtime. Each language ships as an optional
dependency, the shape `sense` already uses for its three platform packages, so a
repository with no Python downloads no Python grammar. The Swift grammar is the
expensive one in both dimensions and it is the only one where that matters;
against the digest cache only changed files are parsed either way.

## What TraceDecay settled, and what it did not

Consulted at `ScriptedAlchemy/tracedecay`: 51,394 lines of extractor over 60
languages, one hand-written tree-sitter extractor per language against a shared
output type, grammars served from two pre-bundled crates behind `lang-*` cargo
features in `lite` / `medium` / `full` tiers.

Taken from it: tree-sitter as the grammar supply; one extractor per language
rather than one generic query layer; compile-time registration behind a
per-language feature rather than discovery; and a bundled grammar crate instead
of forty `build.rs` C compiles. Also the cost scale — roughly 850 lines of
extractor per language, which is what makes "add a language" a decision rather
than a config key.

Not taken: the model, and the difference is the whole reason one record space is
affordable here. TraceDecay's graph is nominal. Its `EdgeKind` is
`Contains | Calls | Uses | Implements | TypeOf | Returns | DerivesMacro | Extends |
Annotates | Receives` — there is no import edge in it — and an import becomes a
`Use` **node** holding the text after `import `, joined afterwards by
`UnresolvedRef { reference_name }` matching a declaration's name. Nothing is
resolved to a file. Its `NodeKind` carries seventy-odd variants sectioned by
language (`// Java-specific`, `// Go-specific`, `// Dart-specific`), which is
decision 2 taken the other way, and it is why sixty languages cost fifty thousand
lines there.

`sense` resolves a specifier to a path and keeps one vocabulary. A language adds
a reader and a resolver; it adds no node kind, no edge kind and no question.

## Consequences

`@variance-authority/help` reads `Read.exports` and `Read.symbols` out of the
index and asks six questions — what is this name, where is it declared, who
imports it, where does the repository write it. None of those is a TypeScript
question, so it sees through the moment a reader exists, and the only JavaScript
still in it is `@variance-authority/package`, which decides a *published* surface
from a `package.json` `exports` field. Python and Swift publish from other
manifests, and until those are read, help answers from the source's own export
set — which is what it already does for a checkout with no manifest at all.

## What this forecloses

- A second `sense`, a second record space, or a per-language node vocabulary.
- Tree-sitter on the JavaScript and TypeScript path, on a uniformity argument.
- Nominal name resolution that picks a candidate. It resolves to all or it does
  not resolve.
- Treating a language's grammar as required. A checkout with no Swift grammar
  installed records its Swift files `unknown` and widens, and never quietly
  omits them.
- Reporting Swift reach at file grain before the refinement that would earn it.
