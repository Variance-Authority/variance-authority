---
"@variance-authority/cli": minor
---

`variance covering` names a line's test files with their share, and `--hops` orders them nearest first

A line or function answer carries `files`: each test file once, with how many of
its cases went through the line out of how many it declares. `--hops` adds each
file's import hops and sorts the files by them, so an editor can list thousands
of cases as a few hundred files, the nearest on top.
