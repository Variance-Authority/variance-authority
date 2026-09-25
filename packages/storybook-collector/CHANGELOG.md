# @variance-authority/storybook-collector

## 0.10.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.9.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

### Minor Changes

- 4250eda: Every run records which case entered each region. The `cases` option is removed
  from `withTestSelection` for Vitest, Jest and Rstest, from the Playwright
  recorder and reporter, and from the Storybook recorder: each writes
  `<coverage file>.cases.bin` beside the file-level snapshot, or `executionFile`
  when you name one. A test file that runs in a page is still recorded per file,
  and says so.

  Without `continuations: true`, a file whose cases overlap no longer fails the
  run. It is recorded as a whole, so a change it reaches runs every case in it, and
  the run names the two cases that were open at once.

### Patch Changes

- e4ee0da: The repository names its cache. Set `cacheRoot` in the `variance.config.json` at the repository root, for example `".variance/cache"`, and every command, every test runner integration and every function that takes a `cacheRoot` option uses that directory. The path resolves against the repository root. Without the key the cache is `$XDG_CACHE_HOME/variance-authority`, or `~/.cache/variance-authority`, as before, so an existing recording stays where it is. The key is read before the environment, so a sandboxed agent that sets `XDG_CACHE_HOME` to a temporary directory no longer splits the recording away from your own runs. [The cache](https://variance-authority.dev/docs/cache) page describes the location, what is in it, worktrees and CI.

  `@variance-authority/sense` exports `cacheRootFor(root)`, which returns that answer, and `CACHE_CONFIG`. `defaultCacheRoot` is removed; call `cacheRootFor(root)`. A `cacheRoot` option now names the variance-authority directory itself, and `test-selection/` is created under it. `testCoverageFile`, `seedTestCoverage`, `readableTestCoverage`, `moduleNamesFile`, `openModuleNames`, `recordStore`, `recordStores` and `repositoryLayers` take an optional `cacheRoot`. An empty or relative `XDG_CACHE_HOME` is ignored rather than resolved against the working directory. A root `variance.config.json` that is not JSON, or whose `cacheRoot` is not a non-empty string, is an error.

  `@variance-authority/cli` accepts `cacheRoot` in the config and in the schema, and refuses it in a `variance.config.json` below the repository root. `variance run`'s render cache and suite indexes are under it. `renderCacheRoot` and `suiteIndexPath` take the config.

## 0.7.0

### Patch Changes

- 8ae7195: A relative `coverageFile` or `executionFile` is read from `root`

  The Vitest, Rstest and Jest integrations resolve these two paths from their own
  root. The Playwright reporter and the Storybook recorder resolved them from the
  root of the repository instead. In a workspace, where `root` is a package
  directory, that caused two problems:

  - The Playwright workers staged their results beside one coverage index, and the
    reporter merged them into a different one.
  - A run where the fixture merged for itself, without the reporter, wrote its
    execution index to a third place.

  Both paths are now read from `root`, as the fixture already read `coverageFile`.
  An absolute path is unchanged.
- 17d7f7e: A story file is recorded under its path in the repository

  Storybook writes each story's `importPath` relative to the directory it ran
  in, with a `./` in front. The recorder resolved that path against the
  repository root. In a workspace, where Storybook runs in a package directory,
  this had two effects: the story file's precondition read a file that does not
  exist and was dropped without a message, and the per-story index named a path
  no diff contains. So a commit that edited only a `.stories` file selected none
  of its stories.

  The recorder now resolves `importPath` from `tests.root`, which defaults to the
  current directory, and records the path relative to the repository root.

## 0.6.0

### Minor Changes

- 16f6dd6: Recorded file names are relative to the repository root

  The Jest, Vitest and Rstest wrappers, the Playwright reporter and the Storybook
  collector now name every file relative to the root of the git checkout the run
  starts in. Before, when the config was inside a package, file names were
  relative to Jest's `rootDir` or Vitest's `root`. A recording made from
  `packages/cart` said `src/cart.ts` where a diff says `packages/cart/src/cart.ts`,
  and the two never matched. `rootDir` and `root` still resolve the config and the
  relative paths in its options. Outside a git checkout, names are relative to the
  directory the run starts in.

  A recording that an earlier version made from a package-level config uses the
  old names, so record it again. `repositoryRoot`, exported from
  `@variance-authority/sense/test-selection`, returns the directory that file
  names are relative to.

## 0.5.10

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.9

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.8

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

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
