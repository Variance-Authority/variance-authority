---
'@variance-authority/sense': minor
---

A Rust transform can place sense's probes itself

The package now ships its instrumenter as a Rust crate, at
`node_modules/@variance-authority/sense/native/instrument`: the code its own
addon runs, so a project with sense installed has the version its runtime
reads. A pipeline over swc, oxc or anything else links it as a Cargo path
dependency and calls `instrument`, `module_id` and `recipe`.

The Jest transformer hands such a pipeline the module untouched. A wrapped
transformer that answers `senseRecipe(mode)` is given `options.senseProbes` —
the file, the module id and the mode — for each module that would have carried
probes, and places them itself. A recipe that is not this package's is refused
when the transformer loads, naming both.

`PROBE_RUNTIME` from `@variance-authority/sense/instrument` is replaced by
`probeRuntime(module, count)`, the header one module carries, and
`probeRecipe(mode)`, the recipe a Rust build is checked against. The header is
written in one place, the crate, and is byte for byte what it was.
