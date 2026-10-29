---
'@variance-authority/mcp': patch
'@variance-authority/cli': patch
'@variance-authority/sense': minor
---

`variance_changed_tests` leaves out a case that mocked the changed module

The tool answered without the file graph, so a case whose test file mocked
the changed module was counted as carried into it while the module evaluated,
though it ran against the mock. It now reads the graph off the tree `readTree`
reads, built by the same `runGraphOf` that `variance covering --since` walks.
A tool on the observability connection gets the tree its host read, and an
answer given without that graph says the cut was not made.
