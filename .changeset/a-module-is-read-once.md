---
'@variance-authority/sense': patch
---

A probed module is read from disk once

The probes read a module's file from disk once at every seam — Vitest, Vite,
Rstest, and the Rspack and webpack loader — and hand the text from the half
that runs ahead of your compilers to the half that places the probes after
them. Nothing read is kept past the module it was read for.

That read is the probes' own, beside the one your bundler makes for its
loaders and plugins, and two places read where you might not expect it. A Vite
dev server's `load` reads every module it serves to ask whether the file names
its own source map, so a module it ends up not probing is read too. Under
Rstest, the second loader reads the file from disk: what Rspack read is gone by
then, and the loader is handed only the text your loaders wrote. A file under
`node_modules` that your `include` does not take is not read by the probes at
all; under Vite and Vitest any other file is read once before `include` is
asked, because only its text says whether it names a map that leads to a file `include` takes.
