---
'@variance-authority/sense': minor
'@variance-authority/sense-darwin-arm64': minor
'@variance-authority/sense-linux-arm64-gnu': minor
'@variance-authority/sense-linux-x64-gnu': minor
'@variance-authority/sense-win32-x64-msvc': minor
---

A module that passes a function to `page.evaluate` can now be instrumented

`page.evaluate(fn)` sends `fn.toString()` to the browser. A probe inside that
text called a declaration the page does not have, and threw `ReferenceError` at
the first one, so a module that handed any function to a page had to stay out
of instrumentation whole. The transform now reads the call: the function passed
to `evaluate`, `evaluateAll`, `evaluateHandle`, `evaluateOnNewDocument`,
`addInitScript`, `waitForFunction`, `$eval` or `$$eval`, written at the call or
declared in the same module, gets no probes. The rest of the module is probed as
before, and an edit inside the function is charged to the region around it. A
function declaration exists from the moment its block starts, so one written
after a `return` is charged to the tests that entered the block, the early
leavers included. A function imported from another module and sent from
this one is not found, and the module that writes it still needs leaving out.

The instrumentation ids are now `sense:instrument/presence-v6` and
`sense:instrument/entries-v3`, so a recording made under the old ids is read as
stale and recorded again.
