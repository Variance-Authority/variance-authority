---
'@variance-authority/distill': minor
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

Distill reads its records in the native addon

`variance distill` over a whole suite read every test file's coverage rows and
case index as objects, which a suite of tens of thousands of test files cannot
afford: one of about 30k test files ran for most of a minute and several
gigabytes of memory, and a larger one did not finish. The sense addon now reads
each record once into what the question needs — per test file the modules it
loaded, per module how many of its cases entered it — and answers the scope,
one test file, and the import behind each module no case entered, in columns.
On a synthetic suite of that shape a whole-suite reading takes a few seconds
in place of most of a minute, and every output is the same, byte for byte.
`--file` still opens the whole record, and takes about a second there.

Breaking: `distillFile` and `distillScope` take the record's bytes as `record`
and the file graph as `relations`, in place of the decoded `coverage` and
`execution` and the `imports`, `lazy` and `republishes` callbacks; drop
`execution`, since the cases and the regions a charge reads come from `record`.
`scopeRows` reads the scope, and refuses one it cannot read, when it is called,
and makes each row as it is reached. They require the addon, and throw naming
why where it did not install.

A record whose case index is in the row spelling, which no current writer
emits, is refused with "record the suite again". `readDistillRecords` is
exported from `@variance-authority/sense/test-selection`; its records answer
`cases` and `regions` for one test file, and `NativeDistillRegion` is the region
they answer.

`variance distill --format jsonl` makes each row as it writes it, and `json`
writes its answer as it serializes it, a piece at a time. A reader that closes
the pipe early, `| head`, ends the command quietly with exit 0.
