---
"@variance-authority/cli": minor
"@variance-authority/sense": patch
---

`variance covering --format refs` numbers each case once and names every range's cases by number

The table at the end lists each test file once with its cases under it, and a
range reads `1-5 walked: 1,3-11,2*`, where `*` marks a case that was inside only
while the module evaluated. The text answer names each test file once, prints
a case's id only when it is not the file and the name, and a range walked by
cases already listed points at the range that listed them.
