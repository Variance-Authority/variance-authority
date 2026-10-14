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
round. A region the map gives no code of its own is recorded running when the
function in front of it is entered, or when the module loads, and a compiler's
own map can widen a region too:
React Compiler's sends the code after an early `return` to the component's
entry. Either selects a test it did not need to, never misses one.

These stop a run that went through before, each with an error naming the file:

- A file your transforms rewrote with a map that leads back to no source that
  is the file. Have the transform write its map against the file it was handed.
- Under Vite or Vitest, a plugin ahead of the probes that rewrote a file and
  returned no source map, named. Return its map, or `map: null` when no position
  moved: `map: null` is believed.
- Under Rstest, a file that reaches the second loader with no map: leave
  Rspack's `devtool` writing source maps, as Rstest sets it.
- Under Rstest, a configuration assembled by hand that names
  `@variance-authority/sense/rstest-loader` and not the new
  `@variance-authority/sense/rstest-after-loader` fails at the first file, or,
  where Rspack lists no loaders, when the run ends. Add the second loader at
  `enforce: 'post'`.

Four cases still meet the probes before your transforms: a file that names its
own source map, such as a built package, under a Vite dev server, Vitest or
Rstest; a file under a Jest transformer that rewrites it and returns no map, or
a map that leads elsewhere, which transforms it twice and now warns once per
transformer, by name;
every file under Vitest browser mode; and a test file, whose lines are marked
for its cases first.

The recipe ids move to `sense:instrument/presence-v7` and
`sense:instrument/entries-v4`. Selection reads a recording made under the old
ids as it stands. The first run that records after upgrading replaces it rather
than merging into it, so make that run the full suite: a selected run would
leave a record of only the tests it ran.
