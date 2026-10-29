# Spec 0104 — the four code questions

**Missing:** one answer shape. `ask symbol`, `ask uses`, `ask search` and
`covering --file` each print prose of their own, with exceptions, hints and
notices grown one gap at a time, and only `search` and `covering` answer in
JSON. A name with two declarations is answered as one: `symbol Coverage` calls
a second package's own interface "also published by" the first, and `uses`
lists its importers under the first. A miss is a paragraph that also reports on
installed dependencies and text search. Nothing is answered about the working tree since the last index.
**Built on:** the source index and its readers in `packages/sense`, and the
renderers in `packages/help/src/tools/` (`symbol.ts`, `uses.ts`, `search`) and
`packages/cli/src/commands/covering*.ts`. The index already holds the facts
below; what is missing is mostly how they are answered.
**Held by:** `packages/cli/src/commands/ask-acceptance-*.test.ts`, over the
checkout in `ask-acceptance.fixture.ts`. A test asserts a fact through
`ask-facts.fixture.ts` and never a sentence, so a renderer can be replaced by changing
that one file. A fact this spec asks for and the answer does not hold yet is an
`it.todo` there.

## Purpose

An agent asks four questions of code before it edits: *what is this name and
where is it declared*, *who uses it*, *what is the name for the thing that does
this*, and *which tests ran this file*. Each answer is read once and acted on.
So the answer opens with the answer, carries every row the question has, and
ends with the questions it opens, as [0105](0105-a-need-names-its-next-move.md)'s
catalogue names them: no other route, no documentation of a dependency, no notice
repeated per row. The same object is returned on the command line and
over MCP.

## The model

One row per **declaration**. A re-export — a barrel, `export * as`, Rust
`pub use` — is not a declaration and not a use: it is followed to the
declaration, and reported as the path that reaches it.

A declaration carries:

| Field | What it holds |
|---|---|
| `name`, `kind`, `file`, `line` | Where it is, and what it is. |
| `visibility` | `published` (an entry of its package reaches it), `exported`, `unexported`, or `member`. |
| `specifier` | For `published`, what a caller writes after `from`, including a subpath. |
| `container` | For `member`, the interface, type or class that declares it. |
| `aliases` | The files that import it under another local name, and that name. |

A use carries the importing `file` and `line`, whether it is in a test, and
what the import does: renamed, type-only, `import()`, read off a namespace, or
a namespace passed on whole. A member's use carries its container and whether
it is a read or a write.

## The questions

**`symbol <name>`** answers every declaration of `name`, published first, each
on its own: two packages that declare a name are two rows, never one row
"also published by" the other. `Container.member` and `--file`/`--kind` narrow
to one. A local alias answers with the declaration it imports.

**`uses <name>`** answers the uses of each declaration apart. Barrels are
followed and never counted. Tests are listed apart from source, and an
unexported declaration by its uses in its own file. A member is answered
through every value written as its container, each use a read or a write;
whatever a type checker would have to infer is TypeScript's to answer.

**`search <words>`** answers one ranked list of declarations by the words of
their name and their documentation: published above exported above
unexported, and within each a name that is the question first — as written,
then the same name in another case — then a rare word above a common one. It
opens on its first hit, and on a miss names the word nothing carries.

**`covering --file <path>`** answers, per region of the file and per suite, the
cases that ran it, apart from the cases that only loaded it. It names the
commit its record was made at and whether the file changed since, and tells
*no record*, *a record under older probes* and *recorded nothing* apart. A path
under `dist/` is read as its source.

Every question answers `--format json`, exits 0 on an answer, 1 on a miss and 2
on an error, and answers a miss in one line that names the nearest declared
names, at the cost of a hit. Every question answers about the working tree.

## What it keeps

These hold today, and the tests pin them:

- the import a caller pastes, including a published subpath;
- the visibility ladder, `exported` told apart from `published`;
- a local alias answered with its declaration;
- members of interfaces and classes, with their container;
- uses: tests apart from source, barrels followed and not counted, the
  renamed, type-only, `import()` and passed-on-whole notes, own-file uses of
  an unexported name, and a member's uses as reads and writes;
- search by name words and by documentation words;
- covering per region, narrowed to a line, a file the run never loaded, and a
  record under older probes; declared preconditions and a suite with no record
  stay pinned by the `covering-*.test.ts` files that build their checkout.

The per-gap tests that pin these facts by their sentences retire with the
renderer they word; the acceptance tests carry the facts across.

## What is left

The `it.todo` entries of the four acceptance files, in order of harm:

1. Each declaration of a name answered apart, in `symbol` and in `uses`.
2. `--format json`, `--file`, `--kind` on `symbol` and `uses`; no cap on rows.
3. `Container.member`, and a name reached through `export * as`.
4. No dependency README prose, no tool of another surface named.
5. `covering`: `dist/` read as source, repository-relative paths only, the
   record's commit, one notice per answer, JSON without repeated cases.
6. A miss in one line, at the cost of a hit.
7. The working tree read over the index.
8. `search` opening on its first hit, one ranked list.
9. Exit codes.
