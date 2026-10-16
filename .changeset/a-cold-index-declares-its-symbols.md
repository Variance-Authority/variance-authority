---
'@variance-authority/sense': minor
'@variance-authority/help': patch
'@variance-authority/mcp': patch
'@variance-authority/cli': patch
---

A cold index of a large checkout declares its symbols

A checkout of ten thousand modules or more is indexed by the native graph in one
call, and every later change by the native update. Both parsed each module
without its declarations, so `ask symbol` and `ask search` answered as if the
checkout declared nothing, and kept answering that way: on seven copies of MUI,
`ask symbol --name useUtilityClasses` said the dependency lexicon was not
published. Both now read the declarations out of the same parse, and the answer
lists them.

Source index format version 24. An index written by an earlier release is
rebuilt by the next `variance index`.

When `symbol` finds nothing, its answer, or its refusal, names the files whose
declarations were not read, such as one over the largest-file limit, so a name
declared there is not reported as declared nowhere.

**Breaking:** `enrichSources` and `HarvestSubject` are removed from
`@variance-authority/sense`. They re-read a parse that held no declarations,
and no parse the index writes is one.
