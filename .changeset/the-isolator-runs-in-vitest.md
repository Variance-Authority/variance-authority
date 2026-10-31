---
'@variance-authority/isolator': patch
---

The isolator runs in Vitest 5 through `@variance-authority/isolator/vite`, so a suite under `isolate: false` keeps its modules loaded across files while every test reads the values they were loaded with.
