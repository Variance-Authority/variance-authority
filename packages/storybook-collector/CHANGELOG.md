# @variance-authority/storybook-collector

## 0.5.5

### Patch Changes

- Updated dependencies
  - @variance-authority/sense@0.5.5
  - @variance-authority/core@0.5.5
  - @variance-authority/dom@0.5.5
  - @variance-authority/playwright@0.5.5
  - @variance-authority/react@0.5.5
  - @variance-authority/storybook@0.5.5

## 0.5.4

### Patch Changes

- Updated dependencies
  - @variance-authority/core@0.5.4
  - @variance-authority/dom@0.5.4
  - @variance-authority/playwright@0.5.4
  - @variance-authority/react@0.5.4
  - @variance-authority/sense@0.5.4
  - @variance-authority/storybook@0.5.4

## 0.5.3

### Patch Changes

- Updated dependencies
  - @variance-authority/sense@0.5.3
  - @variance-authority/core@0.5.3
  - @variance-authority/dom@0.5.3
  - @variance-authority/playwright@0.5.3
  - @variance-authority/react@0.5.3
  - @variance-authority/storybook@0.5.3

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

### Patch Changes

  - @variance-authority/dom@0.5.0
  - @variance-authority/playwright@0.5.0
  - @variance-authority/react@0.5.0
  - @variance-authority/sense@0.5.0
  - @variance-authority/storybook@0.5.0

## 0.4.1

### Patch Changes

  - @variance-authority/dom@0.4.1
  - @variance-authority/playwright@0.4.1
  - @variance-authority/react@0.4.1
  - @variance-authority/sense@0.4.1
  - @variance-authority/storybook@0.4.1

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.2.0

### Minor Changes

- 8efba76: A run that changed ten files stops rewriting the whole selection index

  Every run after the first reads the selection index, lays its own recording over
  it, and writes it back. At a repository's scale almost all of that was spent
  making objects nobody reads: a run that re-records ten modules of twenty thousand
  decoded six hundred thousand regions into a model, merged ten of them, and
  encoded the model back — the other 99.95% of the index materialized and
  re-serialized to arrive at the bytes it was read from.

  `layerTestCoverage` does the merge and the encode as one pass over the columns
  the previous snapshot is already stored in. A module the run did not touch is
  never made an object: its rows are copied column to column as integers, its
  strings blob to blob as bytes, and the only thing that happens to either is the
  renumbering the new dictionary implies. Objects are made for what the merge has
  to reason about — the tests, the modules this run re-recorded, and the carried
  modules whose text moved on disk. Over twenty thousand modules that is 1855 ms to
  616, and it is byte for byte the same file, which a gate asserts across every
  case the merge distinguishes.

  The columns are now zstd rather than brotli, at two levels, because the runs are
  two kinds of data. A varint run is a dense stream of small integers and answers
  to a long search; a run of the string blob is file paths and hex digests, which
  zstd finds most of at level 1 and nothing more of above it. Against the brotli
  quality 4 it replaces, over the same snapshot: 319 ms to compress became 120, and
  the file got 86 KB smaller.

  `zlib.zstdCompressSync` arrived in Node 22.15, so that is the floor these
  packages declare. The snapshot's layout version moved with the codec, which means
  an index written by an earlier build is refused at its header and rebuilt — one
  full run, and nothing a reader has to think about.

### Patch Changes

- e546e21: Where the JSX settings live under Vite 8

  Vite 8 transforms with oxc, so `esbuild: { jsx, jsxDev, jsxImportSource }` becomes
  `oxc: { jsx: { runtime, development, importSource } }`, and `esbuild.keepNames`
  becomes `build.rolldownOptions.output.keepNames`. A config keeps whichever keys it
  is given and reads only the ones its own major knows, so the wrong block is not an
  error, not a warning and not a log line: the plugin installs, the bundle runs,
  every subject renders, and every report names the line a component is declared on
  instead of the line that wrote the element. It fails in the direction that looks
  like it worked.

  The `jsx-source` README carries a table of where the two settings live per
  transform, both spellings on every copyable snippet, and the reminder to read
  `provenanceOf`'s result rather than the config — the config cannot tell you.
  `storybook-collector` gets the same for `keepNames`, on the symptom it produces: a
  confident report naming a component that appears nowhere in your source.

## 0.1.1

### Patch Changes

- db08866: Keep the run when the execution journal cannot be recorded.

  `close()` already held the position that a journal is not the artefact under
  review: a recorder that declines to record is written to stderr and the run
  continues, because failing the run over it would cost every subject in it the
  baselines it just captured. Only the declining half was handled. A throw out of
  the same call — `duplicate test coverage observation` was the one reached in
  practice — went straight up through `close()` and took the run down with it.
  Both outcomes now end the same way, in a sentence on stderr and a run that keeps
  its images.

## 0.1.0

First release.
