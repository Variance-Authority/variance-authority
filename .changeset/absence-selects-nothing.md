---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A changed file the record has no row for no longer runs the whole suite

A changed path the record has no row or declaration for, and the graph does not
list — a README, a fixture a test reads with `fs`, a script a test spawns — is
listed in `unread` and selects nothing by itself. `unread` is a report: the skip
list is `whole` less `entered` whatever it lists. `variance select` and
`variance run --since` name those paths on stderr, and `variance select --format
json` lists them under `unread`. A file the suite rests on without importing it
goes in the `preconditions` option of the Vitest, Jest or Rstest integration,
and a change to it then selects every test that declared it.

A changed module with no instrumented row under any of its names — one the
recording did not instrument, or one added since it — is walked to the files
that import it along every runtime edge, never `type`, and each chain stops at
the first test file or instrumented module it reaches. A module with a row but
no probes is walked past, and the tests that declare it are selected. A test
that mocked the changed module, or a file between it and the row, is cut. A
stylesheet, image or JSON file is walked along `asset` edges, as before.

Each importer answers for itself. A changed file whose importers the record
measured only in part selects the tests of the measured ones: an importer with
no row selects nobody and no longer voids what the chain beside it selects. A
file known under two names, its source and its built twin, is answered when
either name has a row, and each name selects the tests recorded under it.

A bumped package is never `unread`. It is walked to every file that imports it
at any distance; the measured ones select their tests, and one the record never
measured selects nothing. Declaring that file as a precondition does not change
this: a precondition selects on a change to the declared file's own text, not on
a bump beneath it.

`variance select` compares the install. It reads the lockfile at the diff's base
and in the working tree, answers a bumped package through the files that import
it, and declines to narrow when the lockfile cannot be compared. The lockfile
and `package.json` are left out of `unread`, because the comparison has already
said what moved. `variance run --since` reads the execution journal after the
baselines and the file graph, and narrows past their whole-suite answers, except
after a change to a `source.before` entry or an install it could not compare:
the journal never saw either, so the run stays whole.

`foldTestCoverage` keeps the instrumented rows where shards disagree about
whether a module could be read. The tests another shard watched run that module
keep their crossings and stay whole, rather than being demoted to incomplete and
running at every selection; the tests that loaded the uninstrumented copy
already declare it as a precondition.

A workspace package imported only with `import type` is not a runtime import.
The native scan records a package edge beside an unresolved bare specifier, with
the kind it was read as, the way the JavaScript scan does, so a caller bridging
workspace specifiers can tell an erased import from a loaded one. The record
cache is discarded once, so a record the native scan wrote without those edges
is read again rather than reused.
