---
'@variance-authority/sense': patch
---

A file that declares `/// <depends path>` on a module is reached by a change to any value in it

A changed exported value was carried to each importer by name, and a file
that names a module with `/// <depends path="…" />` binds no name from it: it
reads the text. So a change to `RATE` in `rate.ts` selected the tests that call
into `RATE` and skipped `source.test.js`, which reads `rate.ts` from disk. It
was not printed as a test the graph could not explain either. Such a file now
reads the whole module: a test is selected, a module with a row charges every
test that loaded it, and a file with neither selects every test that loads it,
as the graph walk over the same edge already did for a file that changed whole.
