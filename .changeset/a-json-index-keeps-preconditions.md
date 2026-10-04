---
'@variance-authority/distill': patch
---

A JSON execution index keeps what the binary one keeps

`parseExecutionIndex` rebuilt each case row from `id`, `file` and `name`, so a
JSON index lost the `preconditions`, `stopped` and `duration` that the recorded
`coverage.bin` spelling of the same cases keeps. `variance covering --execution
index.json --where <name>` therefore refused a JSON index as unmeasured even
when its rows said what they arranged. A JSON row carries all three, each
validated: `stopped` a boolean, `duration` a non-negative integer of
milliseconds, and each `preconditions` entry with `name` and `site` non-empty
strings, `value` a string, number or boolean, and `level` a non-negative
integer. A field a row leaves out stays absent; an empty `preconditions` list
stays a case heard to say nothing.

A row whose `preconditions`, `stopped` or `duration` field is malformed is
refused with the row's position, and the entry's for a precondition, where
before the field was dropped.
