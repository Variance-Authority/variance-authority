---
'@variance-authority/sense': patch
---

A Jest project with `automock: true` records coverage: the collector the selection setup file loads is no longer automocked, which left every instrumented setup file throwing at its first probe.
