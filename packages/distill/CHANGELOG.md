# @variance-authority/distill

## 0.3.0

### Minor Changes

- 208fff4: An import is not a use

  Distill read an entered file and nothing smaller. Any crossing anywhere in a
  module made the file entered, at the shortest depth observed, and which region
  had been crossed was dropped on the way out. That is the reading test selection
  needs and it is built to over-answer: a module's initialization is attributed to
  every test that consumed the module, so a change cannot skip a test.

  Reduction asks the opposite question. `import { A } from './B'` runs `B`'s top
  level and nothing else — a spy answers in `A`'s place, or the branch that would
  have rendered it is never taken — and the module root is crossed either way. Run
  through a conservative file-level index, a component nothing rendered came back
  as source the test reached.

  `EnteredModule` is the second reading of the same crossings, one region at a
  time. `loadedOnly` marks a module whose every crossing is a consequence of
  loading it; `unentered` names the declarations the test never reached, at the
  outermost declaration that owns them. A module root has no caller a test could
  be, so both are derived from the region's own kind and ask nothing new of a
  producer. `ExecutionCrossing.loaded` is there for a producer that watched the
  evaluation and can say the same about a region below the root — a function the
  top level called — and that mark is believed over the kind.

  `formatDistillation` names those modules and the substitution to try against
  each. The substitution is a candidate: mocking takes the top level with the
  rest, and a top level that registers a handler, installs a polyfill or builds a
  singleton is one the test may be standing on. Make it, rerun the exact test,
  compare the witness.

  `parseExecutionIndex` also stops rejecting a module root. It required every
  block name to be non-empty, and a module root is the one region with no
  declaration to be named after — so no index carrying one could cross the CLI's
  JSON boundary.

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
- ff718d3: Distil one test to the behavior it witnesses.

  `@variance-authority/distill` combines an Eyes attention journal and a Sense
  execution index by exact test identity. It keeps authored Arrange, Act and
  Assert attention, React update initiators, and whole-test source entry separate,
  then names entered files without addressed source attribution as opportunities
  for a counterfactual check rather than safe mocks.

  `variance distill` reads the portable files from a shell and can emit text or
  JSON. A combined MCP connection exposes the same analyzer as
  `variance_distill`; the former `variance_testing_surface` name is replaced.
