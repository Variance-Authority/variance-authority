---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/package': minor
'@variance-authority/cli': minor
---

`symbol`, `search` and `uses` answer a name a file declares and does not export

The source index harvests the top-level declarations of every file it parses,
and `symbol`, `search` and `uses` read only the exported ones. A module-private
function such as `relaunch` in `packages/cli/src/bin.ts` was answered by
`symbol` with *the dependency lexicon is not published*, by `search` with
*Nothing in this repository is named* it, and by `uses` with *not published by
this workspace*, while `git grep` found it at once. A Rust, Python, Swift, Java
or Kotlin file was worse off: its reader harvested no declarations, and the
index recorded it as declaring none.

The Rust, Python, Swift, Java and Kotlin readers now record every top-level
declaration with its kind, line, signature and the doc above it: the `///`
lines or `/** */` block, past Rust's attributes, and a Python definition's
docstring. Underscored Python names and Rust items that are not `pub` are
recorded too. A file a reader could not parse is recorded as not harvested,
rather than as declaring nothing.

`symbol` answers such a name, when no entry publishes it and no file exports it,
with one block per declaration: its kind, the file and line that declare it and
the package that owns them, its signature and documentation as the checkout
holds them, and who can reach it under the file's language. Nothing outside a
JavaScript or TypeScript module can import it; only its module and the modules
inside it can name a Rust item; another Python module can still import it by
name. Each reader records that reach with the declaration, and one that cannot
tell — a script or CommonJS file, a module that hands itself out with
`export =`, a `macro_rules!` — records none, which the answer says. Source comes before tests and stories, and past five declarations the rest
are counted. `search` lists the declarations whose names or documentation hold
the query under *N more names are declared somewhere in the repository without
being exported*, after the exported ones, and within the area when `from` or
`to` is given. `uses` answers with the file and line that declare it, and who
can reach it, before any member declared by that name. A declaration its own
file exports, under its name or another, is left to the export lists. When some
files' declarations were not read — a file over the size a read opens, one that
is not UTF-8, one its reader did not harvest — the answer or refusal names them,
since a name may be declared there.

`@variance-authority/sense` exports `declaredOf(root, query, { containing, files
})`, which reads these declarations off the published source index, and a
`SourceSymbol` carries its `reach`. `@variance-authority/package`'s
`DeclarationKind` names the kinds the new readers harvest: `struct`, `trait`,
`macro`, `record`, `protocol` and the rest. The source
index format moves to version 21; the first `variance index` after upgrading
writes it again.
