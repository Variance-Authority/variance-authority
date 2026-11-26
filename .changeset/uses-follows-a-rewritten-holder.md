---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`uses` and `discover --imports` follow a variable the file writes again. `let m = await import('./a')`, then `m = createStub()`, then `m.foo()` listed `foo` as read off `./a`, though `m` no longer held it, and `if (offline) m = await import('./b')` before `m.foo()` listed `foo` off `./b` alone, though `m` may still hold `./a`. A read off such a variable is now listed for each module a write that may reach the read put there, and for none after a write of something else on every path. A write in a branch, on the right of `&&`, `||` or `??`, in a `??=` or in an optional call's arguments adds its module beside the one held before; a write lower in a loop reaches the reads above it the next time round, and one before a `break`, a `continue` or a throw reaches where it jumps; a write inside a function or an instance field may run at any time, so its module reaches every read; and a read inside one, an `export { m }` and a type query read each module the variable is given. The same holds for a variable a `require` loads.

`variance index` rebuilds the source index once: its format version is 53, in which a read off a variable the file writes again carries the modules the writes that may reach it put there.
