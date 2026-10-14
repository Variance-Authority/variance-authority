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
probes after your transforms: in Vite at `enforce: 'post'`, in Jest
around the transformer you configured, in Rstest with a second loader at
`enforce: 'post'`. Each module is still cut from the file on disk — named after
it, digested as its text, placed on its lines — and the probes are written into
the transformed text where the transforms' combined map carries each region.
A plugin of yours whose `transform` is ordered `post` and listed after
`testSelectionProbes` still runs after the probes, and the configuration now
warns with its name; list it before. A plain `transform` at `enforce: 'post'`
runs ahead of the probes. The plugin's `transform` is now an object hook,
`{ order, handler }`: code that calls it directly calls `transform.handler`.
Under Rstest the second loader's rule goes first among the rules, after
`tools.rspack` has run, so it runs after every post loader of yours.

A `vite build` that writes no source map, Vite's default, still places the
probes where your code went. Vite reprints a module that reads
`import.meta.env`, `process.env` or a `define`, and hands its map on only where
the build writes maps, so `testSelectionProbes` turns maps on for the
transforms, as `hidden`, and takes every `.map` file that wrote back out of the
bundle: the build writes what it wrote without the probes.

`instrument()` answers two more fields: `module`, whether the text imports or
exports, and `headerAt`, where the header starts past the directive prologue.

A region can now be recorded as running when it did not. A region the map
gives no code of its own is recorded running when the function holding the
code in front of it is entered, or when the module loads, and a compiler's own
map can widen a region too: React Compiler's sends the code after an early
`return` to the component's entry, and its `c()` cache call maps to the
import, so a probe fires on every render. An import of a variant of a file,
such as `?raw`, that no map leads back from is recorded as the file loaded.
Each selects a test it did not need to. None leaves out a test that ran the
region.

These stop a run that went through before, each with an error naming the file:

- A file your transforms rewrote with a map that leads back to no source that
  is the file, that carries a text for the file other than the file on disk, or,
  for a file with more regions than the module's own, that holds no mappings. Have the transform write its map against the file it
  was handed.
- Under Vite or Vitest, a plugin ahead of the probes whose `transform` or
  `load` rewrote a file and returned no source map, named. Return its map, or
  `map: null` when no position moved. A `map: null` returned for text that
  moved is caught where a later step writes a map, as the map's text for the
  file then is not the file.
- Text your transforms wrote that the instrumenter cannot parse, from a file
  it can.
- Under Vitest, a test file the run cuts whose `load` hook rewrote it, named
  by the hook's plugin. Any other file a `load` hook rewrote goes on to the
  probes, which place it through the map the hook returned.
- Under Rstest, a file that reaches the second loader with no map: leave
  Rspack's `devtool` writing source maps, as Rstest sets it.
- Under Rstest, a configuration assembled by hand that names
  `@variance-authority/sense/rstest-loader` and not the new
  `@variance-authority/sense/rstest-after-loader` fails at the first file, or,
  where Rspack lists no loaders, when the run ends. Add the second loader at
  `enforce: 'post'`.

Four cases still meet the probes before your transforms: a file that names its
own source map, such as a built package, under a Vite dev server, Vitest or
Rstest, and under Jest where the transformer composed that map; a file under a Jest transformer that rewrites it and returns no map, or
a map that leads elsewhere, which transforms it twice and now warns once per
transformer, by name;
every file under Vitest browser mode; and a test file, whose lines are marked
for its cases first.
