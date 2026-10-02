---
'@variance-authority/cli': minor
'@variance-authority/distill': minor
'@variance-authority/playwright-test': minor
'@variance-authority/sense': minor
'@variance-authority/storybook-collector': minor
---

A run's cases travel in its record

The case index, the cases a run replaced and the run that replaced them are
sections of `coverage.bin`, no longer a `coverage.bin.cases.bin` beside it. The
one file is landed, layered, seeded, repinned, sharded and shared by the same
rules and under the same lock as the coverage it was recorded with, so the two
always answer for the same runs. A share, a seed or a fetch carries the index
and drops the replaced cases and the run that names them, which belong to the
machine that ran.

A record that carries cases is format 10, and a reader that knows only coverage
refuses it rather than misreading it. A record without cases keeps format 9. A
`coverage.bin.cases.bin` left from an earlier run is not read; the next run
writes its cases into the record.

The `executionFile` option is removed from `withTestSelection`, the Jest and
rstest seams, `startRecording`, the Playwright reporter and the Storybook
collector, along with the JSON it could write. `decodeExecutionIndex`,
`readExecutionIndex`, `variance covering --against`, `variance review` and
`distill --execution` read the index out of a record; JSON stays readable as
the spelling a foreign tool supplies. `landCaseIndexes` is replaced by
`landCases`, which returns the sections for the record you write, and
`lastCaseRunOf` reads the run they name. `caseLayerFiles` and
`executionIndexBytes`, which named and read the file beside the record, are
removed. `CaseSections`, `caseSectionsAt`, `caseSectionsOf`, `caseIndexOf`,
`recordedCases`, `withCaseSections`, `keepsCases` and `sharedRecord` read and
write the sections.
