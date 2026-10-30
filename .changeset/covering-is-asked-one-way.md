---
'@variance-authority/mcp': minor
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

Which tests covered a place is asked one way

`@variance-authority/mcp` no longer serves `variance_source_tests` and
`variance_changed_tests`. It no longer exports the `SOURCE_TEST_TOOLS` set,
`sourceTestToolByName` or the `SOURCE_TESTS` served set, `OBSERVABILITY` no
longer carries the two tools, and `Tree` no longer holds `relations`, which only
`variance_changed_tests` read. The pair answered `variance covering`'s question
with a copy of their own that read the record without the commit it was written
at and without asking whether each test file ran over the file as it is now, so
one place could be answered two ways. `variance covering` is the answer, with
`--file`, `--line`, `--function` and `--since`. `variance_distill` still reads
the execution index over MCP. The skill's MCP, covering and producers
references, and the `mcp` and `sense` READMEs, send a reader to `variance
covering`.
