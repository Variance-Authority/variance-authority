---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`uses` and `discover --imports` follow a variable the file writes again. `let m = await import('./a')`, then `m = createStub()`, then `m.foo()` listed `foo` as read off `./a`, though `m` no longer held it, and `if (offline) m = await import('./b')` before `m.foo()` listed `foo` off `./b` alone, though `m` may still hold `./a`. A read off such a variable is now listed for each module a write that may reach the read put there, and for none after a write of something else on every path. A write in a branch, on the right of `&&`, `||` or `??`, in a `??=` or on its right, in an optional call's arguments, or inside a loop, a `switch`, a label or a `try`, which a jump or a throw may leave from anywhere, adds its module beside the one held before; a write inside a function may run at any time, so its module stays held from that write on; and a read inside a function, or a type query, reads each module the variable was given above it. The same holds for a variable a `require` loads.

`variance index` rebuilds the source index once: its format version is 53, in which a read off a variable the file writes again carries the modules the writes that may reach it put there.
