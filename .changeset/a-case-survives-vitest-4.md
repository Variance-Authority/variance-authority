---
'@variance-authority/sense': minor
---

A case survives Vitest 4, and an uninstrumentable file says why

`withTestSelection({ cases: true })` reported *no tests*, wrote an execution index
with nothing in it, and exited zero. Green, and empty — which is the worst shape a
failure can take, because nothing downstream has any reason to look.

The setup shim and the case runner were virtual ids this plugin resolved and
loaded. Vitest 4 loads `setupFiles` and `test.runner` through Vite's module
runner, which resolves them *before* any plugin of the test config is consulted,
so both came back `ERR_MODULE_NOT_FOUND`. They are real files on disk now, at
absolute paths, written under `.variance-authority/` and named after the run — a
path needs no plugin on any major, and the per-run name keeps a watch run and a
CLI run over one project from writing each other's shim. The files are removed once the
journals are folded, though the directory itself stays; git does not track an
empty directory, but add `.variance-authority/` to your ignore file if you would
rather not see it, or if a crashed run leaves a shim behind.

The `vitest` peer range was `^2.1.9`, so installing beside Vitest 3 or 4 either
failed outright or required an override to attempt at all. It is now
`^2.1.9 || ^3.0.0 || ^4.0.0`.

**A `globalSetup` file is no longer instrumented.** It runs once, in the Vitest
process, before any test environment exists — the shim that installs
`globalThis.__VA__` is a `setupFiles` entry and has never run there. Instrumented,
such a file threw at its first probe and took the whole suite down before a single
test loaded. The resolved config names these files, so they are excluded by path
rather than guessed at from their names.

**And when a probe does find no factory, it says so.** `globalThis.__VA__ is not a
function` names a missing global and leaves you to discover that the global
belongs to a transform you did not ask for, on a file you did not expect it on.
The error now names the file, says an instrumented module ran outside the
environment the shim initialises, lists the contexts where that happens — a
`globalSetup` file, a config file, a build script — and tells you to narrow
`include`.
