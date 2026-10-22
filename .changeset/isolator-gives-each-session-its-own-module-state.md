---
'@variance-authority/isolator': minor
---

New, experimental package: a transform that moves a module's mutable state — every module-level `let` or `var` the module writes and does not export, and every declaration that holds an object of its own — into a frame with one set of values per session. Functions, classes and values nobody writes are never wrapped. `isolate(code, file)` from `/transform` is the whole transform; `/jest` and `/loader` (Rspack and webpack) call it. Each declaration runs once; every session starts from a copy of what the module held once it loaded. ioc's per-test driver starts a new session before each test, and `isolateConcurrentTests(test)` one per concurrent Jest test; `isolated(fn)` makes one in Node, `requestSessions()` one per React Server Components request, and `nextSession()` one in a browser. `@isolator-ignore` and `exclude` keep a declaration or a path shared. Every read goes through a JavaScript frame; its performance waits on a Rust port.
