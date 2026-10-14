---
'@variance-authority/sense': minor
'@variance-authority/sense-darwin-arm64': minor
'@variance-authority/sense-linux-arm64-gnu': minor
'@variance-authority/sense-linux-x64-gnu': minor
'@variance-authority/sense-win32-x64-msvc': minor
---

A build-time compiler reads your code, not the probes

Every seam probed a module before your own transforms ran, so a compiler that
reads the syntax it compiles saw a probe where your code was. Compiled could not
extract the styles of a `styled` call that takes a function, and silently turned
a dynamic prop into a runtime CSS variable, so the recorded build was not the
build you ship. React Compiler restructured probed components the same way.
`testSelectionProbes` and the Vitest, Jest and Rstest seams now place the
probes after every transform of yours: in Vite at `enforce: 'post'`, in Jest
around the transformer you configured, in Rstest with a second loader at
`enforce: 'post'`. Each module is still cut from the file on disk — named after
it, digested as its text, placed on its lines — and the probes are written into
the transformed text where the transforms' combined map carries each region.

A region can now be recorded as running when it did not, never the other way
round. A region the map gives no code of its own is recorded with the code in
front of it that encloses it, and a compiler's own map can widen a region too:
React Compiler's sends the code after an early `return` to the component's
entry. Either selects a test it did not need to, never misses one.

These stop a run that went through before, each with an error naming the file:

- A file your transforms rewrote with no map back to it, or a region the map
  carries to no code.
- Under a Vite dev server or Vitest, a plugin ahead of the probes that rewrote a
  file and returned no source map, named. Return its map, or `map: null` when no
  position moved.
- Under Rstest, a file that reaches the second loader with no map: leave
  Rspack's `devtool` writing source maps, as Rstest sets it.
- Under Rstest, a configuration assembled by hand that names
  `@variance-authority/sense/rstest-loader` and not the new
  `@variance-authority/sense/rstest-after-loader` fails when the run ends.

Four cases still meet the probes before your transforms: a file that names its
own source map, such as a built package; a file under a Jest transformer that
rewrites it and returns no map, which now warns once per transformer, by name;
every file under Vitest browser mode; and a test file, whose lines are marked
for its cases first.

The recipe ids move to `sense:instrument/presence-v7` and
`sense:instrument/entries-v4`. A recording made under the old ids opens, is read
as stale, and is recorded again.
