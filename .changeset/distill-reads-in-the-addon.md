---
'@variance-authority/distill': minor
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

Distill reads its records in the native addon

`variance distill` over a whole suite read every test file's coverage rows and
case index as objects, which a suite of tens of thousands of test files cannot
afford: one of about 30k test files ran for most of a minute and several
gigabytes of heap, and a larger one did not finish. The sense addon now reads
each record once into what the question needs — per test file the modules it
loaded, per module how many of its cases entered it — and answers the scope,
one test file, and the import behind each module no case entered, in columns.
The same suite reads in a few seconds, and every output is the same, byte for
byte.

`distillFile` and `distillScope` take the record's bytes as `record` and the
file graph as `relations`, in place of the decoded `coverage` and the
`imports`, `lazy` and `republishes` callbacks. `chargesOf` takes `loading`, how
many test files load a file, in place of `coverage`. `readDistillRecords` and
`encodeTestCoverage` are exported from `@variance-authority/sense/test-selection`.
A case index written in the row spelling is still read.
