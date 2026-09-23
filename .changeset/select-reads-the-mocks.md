---
'@variance-authority/cli': patch
---

`variance select` and `variance covering --since` build the file graph, so a change inside a module a test mocked, or behind that mock, no longer selects that test.
