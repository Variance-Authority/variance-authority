---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/package': patch
'@variance-authority/sense': patch
---

`search` finds a name no manifest publishes by the words of its doc comment

`variance ask search` matched an exported name that no entrypoint publishes by
its name alone, although `ask symbol` and `ask uses` send you there for exactly
that name: "ask `search` with a word from its documentation". A helper is
usually looked for by what it does, because whoever is looking does not know
its name yet. So `variance ask search --query 'owner directory'` missed
`pub(crate) fn owner_of` in the native crate, although its `///` comment says
"its nearest named directory".

An exported name's doc is now read the way a published name's is: by
substring, by the words it holds, and by the loose reading. That covers:

- a JSDoc block above a TypeScript export;
- `///` lines or a `/** … */` block above a Rust, Java, Kotlin or Swift
  declaration, past its attributes or annotations;
- the docstring a Python class or function opens with.

The unpublished line shows the first paragraph of the doc:
`owner_of — @variance-authority/sense · packages/sense/native/src/package_owners.rs:190 — Any path's package, tracked or not: …`.
In `--format json`, an `exported` row carries it as `summary`.

The Rust, Java, Kotlin, Swift and Python readers now record a declaration's
doc, so the source index format moves to version 20. The first `variance index`
after upgrading reads every file again. The search file `variance index`
publishes moves to version 3.
