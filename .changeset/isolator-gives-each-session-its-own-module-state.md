---
'@variance-authority/isolator': minor
---

New package: a Jest transformer and an Rspack loader that move every module-level `let`, `var` and object-holding `const` into a frame with one set of values per session. Each declaration runs once; every session starts from a copy of what the module held once it loaded. ioc's per-test driver starts a new session before each test; `isolated(fn)` makes one in Node, `requestSessions()` one per React Server Components request, and `nextSession()` one in a browser. `@isolator-ignore` and `exclude` keep a declaration or a path shared.
