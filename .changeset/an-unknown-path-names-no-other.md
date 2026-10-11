---
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

`ask journey-map` and `ask slowest-tests` name only the path you asked about when nothing holds it

When a path was in neither the recording nor the files git lists,
`journey-map` and `slowest-tests` offered another recorded path as the one you
meant: one a typo away, or the recorded files that share its file name, so
`src/test-selection/since.ts` was answered with `src/commands/since.ts`, a
different file. Two paths are two files, so the refusal now names the asked
path, says it read the recording and the files git lists, and that both name
each file from the repository root, and names no other path. The same holds for
`docs_journey_map` and `docs_slowest_tests` over MCP.
