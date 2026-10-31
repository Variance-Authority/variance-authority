# @variance-authority/mcp

## 0.22.0

### Minor Changes

- f606d7d: A hint names what you can type where you asked

  An answer's hints were spelled for one surface and printed on both. Each is
  now spelled for the surface that asked:

  - From a shell, `variance ask` and `variance-authority-help` name an input as
    its flag (`--limit`, `--query`, `--from`), a tool as the command that runs it
    (`variance ask symbol`), and a whole question, such as the `grep` that finds
    an underscored name, as the command line that asks it.
  - Over MCP, the same hints use the wire's names: the input `limit`, the tool
    `docs_symbol`, and a question as the tool with its inputs. This covers the
    `search` and `grep` hints, the `--package` refusal, the operands an
    `intersection` names, and the line every listing (`costs`, `run_signals`
    among them) adds for the rows it left out. A `limit` refused from a shell
    names `--limit`, and over MCP names `limit`.

  The lexicon line of `symbol` names `variance index` as the command that
  publishes the dependency lexicon, on both surfaces.

  A tool invocation carries the shell it was asked from as `shell`.
  `@variance-authority/mcp/tools` exports the one spelling every surface uses:
  `spellingOf`, `verbOf`, `flagOf` and the `Spelling` type. `limitOf` and
  `notShown` take a `Spelling`. The CLI's `questionOf` is removed; `verbOf`
  replaces it.

  `Spelling` and `verbOf` take a declared tool — its name, description and input
  schema — so a hint cannot be spelled from a tool name written as a string, and
  renaming a tool fails the build of every hint that names it.
- 9e1e684: Which tests covered a place is asked one way

  `@variance-authority/mcp` no longer serves `variance_source_tests` and
  `variance_changed_tests`. It no longer exports the `SOURCE_TEST_TOOLS` set,
  `sourceTestToolByName` or the `SOURCE_TESTS` served set, `OBSERVABILITY` no
  longer carries the two tools, and `Tree` no longer holds `relations`, which only
  `variance_changed_tests` read. The pair answered `variance covering`'s question
  with a copy of their own that read the record without the commit it was written
  at and without asking whether each test file ran over the file as it is now, so
  one place could be answered two ways. `variance covering` is the answer, with
  `--file`, `--line`, `--function` and `--since`. `variance_distill` still reads
  the execution index over MCP. The skill's MCP, covering and producers
  references, and the `mcp` and `sense` READMEs, send a reader to `variance
  covering`.
- 1c40704: `ask uses` names the files whose imports the source index resolved to no file when one could take the name, since a use there is not listed. For a name no file here declares but a file imports from a package outside the workspace or a runtime module, the answer names each source and the `discover --imports <source>#<name>` question that lists the files; over MCP it names the command to run in the checkout, since `docs_discover` there refuses the question. A path alias such as `@/lib`, a `paths` or `baseUrl` mapping a `tsconfig` or `jsconfig` declares, and a package of this workspace are never named as outside sources; an unresolved one of them, or a `#` subpath import, is named among the files that could take the name. `@variance-authority/sense` publishes `outsideSourcesOf(root, name, index?)`, and `importersOf` carries `unresolved`. `@variance-authority/mcp/tools` publishes `conjoined`, which joins words as `a, b and c`.

### Patch Changes

- 76db46b: The whole-file answer names the region no case entered

  `variance covering --file <path>` painted a function's cases over every line of
  it, so a one-line branch no case took read as walked: its only line also charges
  the function, and the range folded into its neighbours. The range now stands on
  its own and says no case entered the branch, with its state — `unwalked`, or a
  hole naming the stopped case. `--format json` carries the regions under the
  range's `unentered`, `--format refs` adds `; unentered <kind> <lines>` to the
  range's line, and the MCP file answer says the same sentence, with the state.
  The opening line of a longer branch no case entered says it too.

  It holds in an answer `--in-package` or `--at-distance` narrowed, and on a file
  edited since the run, where the region is named at the line it stands on now
  and left out when the edit removed it. `coveringTestsInFile` takes `keep`, the
  cases it names, and folds its ranges over what is left.
  `@variance-authority/sense/test-selection` exports `unenteredSentence`,
  `whyUnentered` and the `Unentered` type, the sentence both surfaces print.
- 84f98e4: `@variance-authority/mcp/tools` exports `rarity(population, holders)`, the integer from 0 to 1000 that `locate`, `orient` and the place line already ranked words by, so another word search ranks by the same count. `heldWeight(held, rarityOf, fieldOf)` sums each held word's rarity times the weight of the field it is held in, the weight `locate` ranks subjects by.
- 9e1e684: The source tree reads the mocks, as `variance covering --since` does

  The source tree `readTree` reads, which `variance ask`, the `docs_*` tools and
  an MCP host walk, now reads `vi.mock`, `jest.mock` and `sb.mock` calls off what
  the parse recorded: a mock subtracts its target from the test file's edges, and
  a real module its factory loads adds one. `@variance-authority/sense` exports
  `runGraphOf`, the one fold that graph and `variance covering --since` are both
  built by: the mocks, then the taints you pass, and the records folded with
  their shadows.

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.19.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.18.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.0

### Minor Changes

- 616287b: `variance_locate` marks a word most of the searched subjects have, and ranks two words said side by side

  A match on a word that more than half the searched subjects have in that field
  prints `(in N of M)`, and the answer names such words above the list. When every
  word of the question is that common, and so is every pair said side by side, the
  headline says that no subject is distinguished and that the order is no answer.

  Two adjacent words of the question found adjacent, in that order, in one
  recorded value rank a subject above one that has the same words apart; the
  value is cut into words as the index cuts it, so `ClearCompleted` says
  `clear completed`. The
  answer prints each such pair under its hit. `LocateHit` gains `pairs` and
  `together`, `LocateMatch` gains `holders` and `common`, and `Located` gains
  `searched`, `common` and `distinguished`.

## 0.16.0

### Minor Changes

- 7768493: `variance covering` answers a run of lines and a scope, and says when an answer is at file grain

  `--line 40-60` asks which cases entered a run of lines. It lands on the
  regions an edit to those lines charges, the same ones `variance select` reads.
  `--function Cart` asks about a class or any other scope: every case that entered
  a recorded function under it, such as `Cart/total`. The `variance_source_tests`
  MCP tool takes a scope the same way.

  An exact `--function X` now also answers the callbacks recorded under it, as
  `X/…`, since they run inside `X`.

  A line whose edit charges the module's own region is answered with the cases
  that loaded the file, and the answer now says it is at file grain: `At file
  grain` in text, `grain: "file"` in JSON. That is a module-level statement, and
  also the first or last line of a top-level function, which selection charges to
  the module as well. In a run of lines, the lines at file grain are listed in
  `fileGrain`, and the lines no recorded region holds, such as imports or types,
  in `outside`. In a run asked against edited text, the lines written since the
  recording are listed in `written` and left out.

  `--hops` measures a run of lines and every `--function`, exact name or scope,
  from the file: a hop runs from the file to a test file.
- 58cae6d: `discover --to` says how each file reaches the path, and takes a name out of a file

  A file two or more imports away from a `--to` path now carries one shortest
  chain of imports to it, `src/Page.ts → src/Model.ts (type import) →
  src/store/selectors.ts`, with each step that is not a plain import marked. The
  chain is built only for the files shown.

  `--to src/store/selectors.ts#selectBalance` answers what rests on one name: the
  walk starts at the files that import `selectBalance`, as `uses` lists them,
  through every barrel that passes it on, so a file that imports another name
  through the same barrel is not reached. The files that import the name show the
  line that does; a file further out has its chain end at that line.

  The `--to` header names the files the walk did not reach that import something
  the scan could not resolve, since they may reach the path through it. It used
  to count the unresolved files among those it reached, which says nothing about
  what reaches the path.

  `@variance-authority/mcp`'s `Tree` has `chainsTo(seeds)`: each file's import
  distance to the seeds, and one shortest chain per file, asked per file.
- 41ea367: A name nothing declares is an answer over MCP, and in `intersection`

  `variance-authority-help` and `variance serve` answer `docs_symbol` and
  `docs_uses` about a name nothing declares with the text `variance ask` prints,
  as a result rather than an error, after reading a reused generation again.
  `variance ask intersection` with a question about such a name answers that no
  file is in all of them, naming beside that question what was read and declares
  nothing, instead of refusing. `serve` takes `answered`, which turns what a tool
  threw into a result, and `foundNothingAnswer` is the answer every surface gives.

### Patch Changes

- 5080f93: A cold index of a large checkout declares its symbols

  A checkout of ten thousand modules or more is indexed by the native graph in one
  call, and every later change by the native update. Both parsed each module
  without its declarations, so `ask symbol` and `ask search` answered as if the
  checkout declared nothing, and kept answering that way: on seven copies of MUI,
  `ask symbol --name useUtilityClasses` said the dependency lexicon was not
  published. Both now read the declarations out of the same parse, and the answer
  lists them.

  Source index format version 24. An index written by an earlier release is
  rebuilt by the next `variance index`.

  When `symbol` finds nothing, its answer, or its refusal, names the files whose
  declarations were not read, such as one over the largest-file limit, so a name
  declared there is not reported as declared nowhere.

  **Breaking:** `enrichSources` and `HarvestSubject` are removed from
  `@variance-authority/sense`. They re-read a parse that held no declarations,
  and no parse the index writes is one.
- 8d1bcc1: A link in a doc comment opens from `node_modules`

  Doc comments linked to documentation by repository paths such as
  `../../../../docs/flakiness.md`, which resolve to nothing in an installed
  package. They now link to the page on variance-authority.dev, or to the file on
  GitHub when the site does not publish it, so the link works on hover in your
  editor and in what `variance ask symbol` prints.

  The MCP server's instructions and its observability answer linked to
  `/start-cli` and `/presentation`, which the site does not serve. They now link
  to `/start/cli` and `/docs/presentation`, and the `@variance-authority/cli`,
  `@variance-authority/help`, `@variance-authority/mcp` and
  `@variance-authority/vitest-browser` READMEs link to the guides where the site
  publishes them.

  `variancePrecondition`, `wiringOf`, `tapCommits` and `provenanceOf` carry an
  `@see` link to the section of the guide that documents them.
- 009b089: A presentation signal with one side missing is `changed`, not `incomparable`.

  A side with no presentation reading, or a reading with no layout findings, now
  gives `verdict: 'changed'` with a `because` that names that side and no effects.
  This is the rule ADR-0090 already applies to one-sided accessibility evidence.
  The signal still changes no subject's verdict.

  `presentationSignal` returns `undefined` when neither side was measured, with
  no reading or no layout findings on both sides, so the member stays absent
  rather than holding a signal about nothing.
  `PresentationSignalRecord` no longer has an `incomparable` variant: tell a
  one-sided record from a compared one by `'because' in signal`. A run-report
  file whose presentation signal says `incomparable` is refused when read.
- bd27740: Importing a pure function from `@variance-authority/mcp` no longer loads the servers beside it

  The root entry exports `locateSubjects` and `readEyesRecord` beside `serve` and
  the `serve*` functions, and Node evaluates every static import of an entry. So
  `import { locateSubjects } from '@variance-authority/mcp'` used to evaluate
  every served tool set, the run report reader, Eyes, the execution-index reader
  and the live-run listener: about 400 modules, where `locateSubjects` needs 11.
  Each of those is now imported by the function that reads it, when it is called:
  `serveReportFile`, `serveEyesRecord`, `serveVantage` and `readEyesRecord`. The
  root entry evaluates 15 modules, and `@variance-authority/help`, which serves
  through `serve`, evaluates about 65 fewer.

  Nothing you call changes: every name is where it was, and each `serve*`
  function was already async. `serve` still starts synchronously; it reads only
  the framing, which `@variance-authority/mcp/protocol` exports as before.
- 8bab581: A refusal names what is missing instead of asking you to run the suite again

  Running a whole suite again to refresh a record is rarely yours to do, so no
  message tells you to. Where something can still be answered, it is:

  - `variance_composition {subject}` against a report with no per-subject
    structure lists the components the census holds in that subject and the
    renderings it shares, and says the report holds no order, depth, mount or
    count within it.
  - `variance_locate` with `under`, `above` or another spatial relation, against
    a run that resolved no layout, prints where the anchor is on each surface that
    says it, and says the run cannot tell what sits in that relation to it.
  - `variance_composition` against a report merged from shards says each shard's
    report still holds its composition, and the suite index the build composes
    from every shard's part holds the census across them.

  Where nothing can be answered, the refusal stays and names the condition, not a
  rerun: shards that started from, or chose their tests from, different records
  are not combined, and the record before the build stands; shards written by
  another version, or of which only some kept cases, are not combined;
  `variance shards --unrecorded 0` says a matrix of none starts no job; a Vitest
  run whose `--reporter` replaced the recording reporter says the record is as it
  was; a distill reading withheld for an incomplete coverage row, and a missing
  unit-test capture directory, name what is missing.
- 2cc4e43: A refusal reads the checkout as it is

  `variance ask`, `variance serve`, `variance-authority-help` and its server
  reused a published source generation for an hour, and the dependency lexicon
  was built only under `variance index`, so a function written since the last
  index was refused as not published, and a fresh checkout refused an installed
  package's export with *the dependency lexicon is not published*. Both read as
  real absences. A refused question is now asked again of a generation made from
  the checkout now, with the dependency lexicon built when it is missing or
  behind, and only that answer is given, under `--changed-file` and
  `--taint-file` too; an answer that found its name still comes from the reused
  generation, so only a refusal pays for the reading. When that reading or the
  lexicon fails, the refusal says which was not compared with the checkout, and
  why.
  Under `--just-answer` or `justAnswer`, and on `search` when no changed files are
  named, every answer and refusal says the checkout was not compared with the
  generation, and `search --format json` carries `compared: false`. The help
  package exports `caughtUp` and `snapshotLine` for hosts of their own, and
  `serve` from `@variance-authority/mcp` takes an `again` hook that asks a
  refused call to a known tool, with its required arguments, again with a fresher
  subject, or ends the refusal with the host's footer.
- 0b6af81: A changed region is joined against the baseline's nodes as well as this render's

  A change that replaces an element paints over the old element's box and the new
  one's, and `attributeRegions` read only one snapshot. On todomvc's broken toggle,
  71% of the changed region is inside the checkbox that left and 88.75% inside the
  div that arrived. Neither reaches the 0.9 containment, so the region named the
  row around both.

  `AttributionOptions.before` is now required: the snapshot of the revision the
  pixels are compared against, or `undefined`. Each node is joined against the
  area its own box and the box of the node the differ's matcher pairs it with in
  `before` cover together: the two places, not the rectangle that holds both.
  A box that left is placed by where it was in its own image, whose corner is the
  new `AttributionOptions.beforeOrigin`: by default the before snapshot's root, so
  a subject the page moved between two clipped shots joins where its pixels are.
  A call that states `origin` with a `before` snapshot and no `beforeOrigin`
  throws, since a corner guessed from the other image is right only when the page
  did not move.

  A baseline keeps that snapshot. `Raster.snapshot` is a `PackedSnapshot`, the
  tree gzipped and in base64, written by the Playwright fixture, its promotion,
  the Vitest browser provider and the CLI's image sidecars. `packSnapshot` and
  `unpackSnapshot` are exported from `@variance-authority/observe`. Every store
  carries it as text: `sidecarFrom` keeps it, `variance push` forwards it, and
  tribunal stores it in new `baselines.snapshot` and
  `build_subjects.candidate_snapshot` columns (schema 21, migration
  `0019_baseline-snapshot.sql`) and promotes it on approval. On
  `cases/storybook-case` it adds 3.2–5.4 KB to each sidecar.

  A baseline without a snapshot says so. When a changed verdict has regions and
  its baseline kept no snapshot, or one that will not unpack, the reason ends
  *the baseline records no snapshot of its nodes, so regions were joined against
  this render's boxes alone: an accepting run records one on a revision where
  this subject is unchanged*. An accepting run — `--update-snapshots`, Vitest's
  `--update`, `variance accept` — now re-stamps an unchanged baseline that kept no
  snapshot, as it re-stamps one painted under another identity, and the
  observation marks it `signals.snapshot: 'unrecorded'`; `restamps` in
  `@variance-authority/core/judge` is the one rule all three ask. Every other
  verdict the mark is on ends *the baseline records no snapshot of its nodes, and
  an accepting run records this one*. Two images
  compared directly get the same clause, naming the before image, without the
  remedy, and are never marked.

  A subject whose document has not moved settles on its digest and builds no
  observation to mark, so `settle` now renders a pictured baseline that kept no
  snapshot when this run collected one, with the reason *the baseline records no
  snapshot of its nodes, so this run renders it for an accepting run to record
  one*. A suite of baselines accepted before this release renders them on every
  run until an accepting run re-stamps them. Tribunal records one on ingest
  instead: a pushed candidate's snapshot is written onto a baseline that has an
  image and kept none, when it was painted from the same document under the same
  identity, and never over one it kept, so such a subject renders once. The
  snapshot's runtime fields (`provenance` and its `createdBy`, `wiring`, `holding`,
  `styleProvenance`, `styleTokens`, `ignoredBy`) are then the recording run's: the
  first push, from a build on any branch, that drew that document, as they are the
  accepting run's on a re-stamp. `Described.keepsSnapshot`
  is the new required field it reads:
  the durable, LFS and tribunal stores derive it from the sidecar with
  `keepsSnapshot` from `@variance-authority/core/format`, and the remote store
  refuses a description without it. A packed snapshot now opens with a `v1:`
  header naming its format version, `PACKED_SNAPSHOT_HEADER`, and a snapshot
  without it counts as not kept. `unpackSnapshot` reads one as not recorded
  unless every node in it is one, with `isSemanticSnapshot`, new in
  `@variance-authority/core/format` beside `isRenderDocument` and
  `isSubjectRef`: the checks `@variance-authority/unit-test` already made of a
  capture file's snapshot, document and subject, which it now asks. Tribunal serves API 6, which describes a
  baseline with `keepsSnapshot`; `variance push` against an older deployment names
  the refused descriptions when the project's `remote` baselines are stored there,
  and the remote store's refusal names tribunal before API 6 and a
  `serveRasterStore` from an earlier `@variance-authority/remote`: upgrade the
  server, tribunal or your own, before the client. `settle` takes this run's snapshot as a
  fifth argument. `variance accept` and the MCP changelog call these subjects
  *unchanged and re-stamped* rather than re-stamped under this run's identity,
  which was untrue of them. The render cache no longer hands on a snapshot an
  entry kept.
- b1a5160: An excluded subject is reported as excluded on purpose

  The pull request comment, the MCP summary and the tribunal's coverage line
  said "excluded by configuration". A subject is also excluded by a story's tags
  or by a page's own `data-variance-exclude`, so they now say "excluded on
  purpose", and the run report keeps each exclusion's reason.
- a15af35: `ask symbol` lists a container's members, and `ask uses` takes `--limit` and follows a passed-on name

  `ask symbol` on an interface, a type alias or a class now lists the members it
  declares after its signature, one line each as the checkout writes it, with its
  file and line. A nested type literal's members are not listed, and an alias that
  fits on its line lists nothing more.

  `ask uses --limit <n>` shows that many rows of each list: each kind of site,
  the lines of the declaring file, and the members by the name. Without it the
  answer shows twelve of each and counts the rest, as before. A `limit` that is not a whole
  number of at least 1 is now refused by `uses`, `grep`, `discover`,
  `intersection`, `slowest-tests` and `variance_costs` alike, rather than read as
  the default, and `variance_costs` now also takes the digits a shell passes.

  A name a file only passes on, as in `export { taxOf as levy } from './tax.js'`,
  is now followed to the declaration it reaches, through every file between them,
  every rename, a type-only `export type { … } from`, a bare `export *`, an
  import the file exports again, and `export { default as x } from`. `ask uses`
  names that declaration after the export line, and `ask symbol` shows its line
  and its members too. Files that only pass a name to each other name no
  declaration, and neither does a namespace or a star asked for `default`.

  Journeys resolve a call through a barrel the same way. A name two `export *`
  reach in different files, and `default` behind an `export *`, used to land in
  the first star's declaration; the call now names no function, as ECMAScript
  resolves neither. Neither does a name behind a star whose request resolved
  to no file of the checkout, or to a file the journeys could not parse, since
  that star may export it too.

  `ask symbol` for a name an import binds with `as` answers its original the
  same way: followed to the declaration a file passes on, with its members.

  Yarn 2 and later have no `-s` flag, so `yarn -s variance` fails before the CLI
  starts. The skill now says that `yarn variance` already prints only the CLI's
  output.
- b7be5b1: An unstable subject is described as read twice in a row, not seconds apart

  The second reading is taken as soon as the first has finished, each one once
  the page says it is ready. Nothing waits between them. The `[unstable]` reasons
  and the `UNSTABLE:` summary line used to say "seconds apart" and "seconds
  later", which read as a deliberate delay.

## 0.15.0

### Minor Changes

- 4426cef: A file argument names one file, spelled from the checkout

  `variance_run_signals` kept every test whose spec file contained the `file`
  argument, so `tests/cart.spec.ts` also took `tests/cart.spec.tsx`, and `cart`
  took both. It now keeps the tests of the one file named, spelled as the listing
  spells it, from the repository root: `tests/../tests/cart.spec.ts` and an
  absolute path name `tests/cart.spec.ts`. Through `variance ask run-signals`, a
  relative path is read from the directory the question is asked in, as a shell
  reads it; through `variance-authority-mcp --watch`, from the repository root. A
  path outside the checkout is refused.

  The `varianceWatched` Playwright fixture names each watched test's file from
  the repository root, as the rest of the record does, rather than from the directory the runner was
  started in: a suite run from `packages/web` lists `packages/web/tests/cart.spec.ts`,
  not `tests/cart.spec.ts`. The watcher and `variance ask` take their checkout from
  git the same way.

  `variance distill --from` reads its directory from `--root`, the working
  directory by default, and spells it the same way. An absolute
  directory, or one with `..` in it, names the directory it resolves to instead of
  finding no test file under it, and a directory outside the checkout, which was
  answered as holding no test file, is refused.
- d5cc0c3: A baseline painted under another identity is compared, and the identity is the cause

  There is no `incomparable` verdict: a subject with two images is always
  compared, and reads `unchanged`, `changed`, `new` or `ignored`. When the two
  were painted under different identities, such as another browser version,
  platform, scale factor, font stack or recipe of this tool, the observation
  carries `signals.identity` (`recipe` or `machine`) and `signals.moved`, each
  moved field with both values, and its `because` opens with that cause. A
  `changed` subject fails the gate whatever its cause, and `variance accept --all`,
  Playwright Test's `--update-snapshots` and Vitest's `--update` adopt it like any
  other change. An `unchanged` subject under a moved identity is re-stamped
  under this run's identity by the same three, so an upgrade is named once rather
  than on every later run. A re-stamp approves nothing: `variance accept` counts
  it in `restamped` and its summary, not among the accepted subjects or the
  commit message, and the `variance_changelog` preview says so. A durable store's
  `put` moves a baseline along its line, one engine family on one platform at one
  scale: the line's older copy is removed, so a lookup never compares against a
  superseded image, while a matrix of engines or machines keeps one baseline
  each. A lookup that misses its own identity reads its line first. `variance_explain` names the moved identity as the
  cause of a change, and the tribunal no longer counts or lists an
  `incomparable` verdict. `@variance-authority/raster` exports `identityCause`,
  which says whether two identities differ in the recipe alone or in the machine,
  with its `IdentityCause` and `ComparedSides` types. `variance doctor` reports a
  store painted by another machine as `PAINTED ELSEWHERE` and exits `0`: the run
  compares it. Its `baselines.comparable` field is now `baselines.paintedHere`.
  The pull-request comment groups these
  subjects under "Painted under another identity", one line per identity that
  moved. Its section for subjects with no image to point at is headed "Nothing to
  point at", which was "Not compared".
- 23d783b: `variance story`, `variance journeys`, `variance distill` and the test tools read a file and a name exactly

  `variance story --file` and `--name` kept every story whose test file path or
  test name held the text you typed, so `--file a.test.ts` also kept
  `data.test.ts`, and `--name adds` kept `data > adds one`. `--in` kept every
  step whose file held its text, and `variance journeys --file` kept a module
  whose path ended with, or whose name held, the text in any case. Each now
  names one thing. `--file` and `--in` are a path in the checkout, read as
  `variance covering --file` and `variance distill --file` read one, and a path outside the checkout is refused
  as one. `--name` is the test's whole name as the runner reports it, its
  `describe` blocks and its own name joined with ` > `. When nothing is that
  path or name, the answer says so, and `variance story` alone lists the stories
  that are written.

  `variance distill --test` took a case's id, its whole title, or any part of
  the title in any case, so `--test submits` read `checkout > submits` when it
  was the only title holding the word. It now takes the id or the whole title,
  `--test 'checkout > submits'`, and a part of either is answered as no case.
  `variance_test_signals` (`variance ask test-signals --test`) and
  `variance_test_attention` did the same and now take the id or the whole title
  too.

  The steps through one workspace package, which `--in @acme/ui` used to open by
  matching the package name as text, are now `variance story --package @acme/ui`.
- 14aefbf: Ask what one test, or one story, checks that the narrower ones inside it do
  not.

  - `variance ask test-composition --file <test> --name <words>`, and
    `docs_test_composition`, read one recorded test as the smaller tests whose
    regions sit inside its own, the larger tests holding it, and the regions no
    smaller test entered: modules only it enters, and paths through a smaller
    test's module only it takes.
  - `variance_composition {subject}` closes with the same reading for a story:
    the smaller stories inside it, the larger ones holding it, and what no
    smaller story renders — components only it mounts, and components a smaller
    story renders another way. The run carries it per subject in the report's
    structure section; `piecesOf` in `@variance-authority/core/attribute`
    computes it.
  - A component mounted by more than half the suite's subjects is structure. A
    subject that mounts a component many times now counts once, where every
    mount used to count: a chip story is an example of the chip again when the
    pages around it mount chips many times over.
- 42599cc: `variance ask discover` answers the files in every one of several sets

  Each set is read whole, with no cap: what a path reaches (`--from`) or what
  reaches it (`--to`), who imports a name (`--imports module#name`, through the
  barrels that pass it on when the module is a file, as `ask uses` reads it), who
  declares a name matching a pattern (`--declares`), and a path pattern (`--path`). Each
  has an `--except-` twin that takes its files out, and `--text` runs ripgrep over
  the files the other sets kept. The answer lists the files nearest the paths
  first, each with the line that put it in each set.

  `readTree` hands each file's declared and imported names to a `names` callback
  during the same scan, read off the parse it already made; a file whose parse
  holds no declarations, as on a checkout large enough for the addon to read
  whole, is read again for them, and the source index keeps what that read
  found. `readNamedTree` takes the question and reads names only for an operand
  that needs them. Over MCP,
  `docs_discover` answers `from`, `to`, `path` and a name imported out of a
  repository file, and refuses `declares` and any other `imports`, because the
  reading an MCP host serves holds no names.
- 0a41a23: Eyes journals travel in the record

  A run that opts into Eyes writes each case's journal into `coverage.bin`, in an
  `eyes` section keyed by the case's id and its attempt, so a journal joins its
  case exactly and a retried case keeps every attempt. The attempt counts from 1
  (Playwright's `retry + 1`) and is a column of its own, never part of the id. A
  run that did not opt in writes no section. Source paths in a journal are
  relative to the repository root, as the case index's are.

  The Playwright fixture and `watchTest` hand their journal to the case the
  recording runs, never to `testInfo.testId`. The RTL `watchTest`, given no id,
  returns the journal and hands it to the running case where the recording seam's
  case scope takes one. The Vitest, Jest and Rstest seams hold each attempt's case
  from before its `beforeEach` until after its `afterEach`, so a journal closed
  in teardown lands under that case and attempt. A run that opts in lists every case it watched in
  the section, so a watched case that handed no journal reads apart from a case
  whose run did not opt in. Two different journals for one case and attempt keep
  the one whose JSON sorts first, and the run still records.

  A journal stays on the machine that ran it. It leaves with the record, through
  `variance share` or an `actions-cache` carry, and each says so: a share names
  every suite entry whose record carried journals, and a carry save notes each
  suite whose record goes into the cache with them. `sharedRecord` keeps the
  section, and drops one that is unreadable or of a newer version at the
  crossing, keeping the rest of the record. A repin keeps the journals of every
  case its index keeps.

  `variance distill` reads the checkout's own record, or the one `--execution`
  names, and prints every attempt of the case. It refuses an id the record does
  not hold and shows the ids it does. `--eyes` is removed, and so are the
  `@variance-authority/eyes/collect` and `@variance-authority/eyes/reporter`
  entries (`writeEyesArchive`, `gatherEyesArchive`, `recordEyesTest`,
  `resetEyesJournals`, `EYES_JOURNAL_SUFFIX`, the Eyes reporter and
  `EyesReporterOptions`). `eyesJournal` and `EyesJournal` give a test's journal,
  and `parseEyesJournal` reads one back. In `@variance-authority/distill`,
  `DistillInput` takes `execution` always and `eyes` as `EyesAttempt` rows, and
  `Distillation` reports `attempts` as `AttemptAttention` in place of
  `attention`, `joined` and `available`; `watched` names the cases a run that
  opted in watched, and distill says which of them kept no journal. The sense
  test-selection entry adds `keepsEyes`, `recordedEyesAt`, `recordedEyesOf`, `RecordedEyes`,
  `ObservedEyes`, `EyesSection` and `encodeAsSetExecutionIndex`. In
  `@variance-authority/mcp`, `serveEyesRecord` replaces `serveEyesArchive` and
  serves the journals a record keeps, read by `readEyesRecord` off one read of
  the record. A record a later run wrote without Eyes leaves it no journals to
  answer from; `readEyesRecord` refuses such a record with `RecordKeepsNoEyes`.
  `EyesArchive` carries `watched`, which `createEyesArchive` takes and
  `parseEyesArchive` reads, so the MCP `distill` tool tells an unwatched case
  from a watched one that kept no journal. That tool needs the runtime journey
  and reads a case by its exact id.

  Under Rstest, a case declared `it(name, options, fn)` is recorded per case, as
  `it(name, fn)` already was.
- f65a928: The share token reads what review settled, and never decides

  A Tribunal deployment now serves `GET /review/changelog`, the new
  `GET /review/decisions` and `GET /review/concerns` to the share token as well as
  the review token, and refuses the ingest token there with 403. Every route that
  decides, or raises or moves a concern, still wants the review token. The
  deployment's API is 5. A share token you already handed
  out reads reviewer names and notes once you redeploy.

  `variance changelog` on a `remote` store reads the deployment's changelog with
  the share token instead of refusing; `--since` takes an instant there.
  `variance ask decisions` and the MCP tool `variance_decisions` on
  `variance serve` list the approvals and rejections on a subject or a build,
  newest first, with who made each and their note. Declare the share token as `{ "env": "VARIANCE_SHARE_TOKEN" }`.
- c337278: The share token reads what reviewers flagged, and why

  `variance ask concerns` and the MCP tool `variance_concerns` on `variance serve`
  list the concerns reviewers raised on a render: the title, the state (open,
  investigating or resolved), the region and component it is about, what the
  reviewer pointed at, and every step since with its note and hypothesis.
  `--subject` or `--build` names which; `--build` reads the concerns on every
  subject the build showed, whichever build raised them, and counts them by state;
  `--state` keeps one state. It reads the same deployment with the same share token
  as `variance ask decisions`, and raises, moves or resolves nothing.

  Every tool in `REVIEW_TOOLS` is a `ReviewTool`, naming the route its subject is
  read from and the query a call sends there, so a host reads each one the same way.
- 8187fb1: `didYouMean` and `nearest` are exported from `@variance-authority/core` and no
  longer from `@variance-authority/mcp/tools`. Import them from
  `@variance-authority/core`. A mistyped command or flag is refused, with the
  nearest right one, without loading the MCP server's tools.

### Patch Changes

- 73f40a8: `variance_changed_tests` prints what each case said, with the call that said it, on the case's line, as `variance covering --since` does.

  `variance covering` prints what each case said, and its twin, in every answer that lists cases. The `--since` text carries them on each case line, and the whole-file and plain `--line` or `--function` answers print each case's twin without `--where`; under `--format json` the answer carries `twins` in every form. A twin comes from the case's own test file, and a large set prints as its count and the first three names. `--where` counts out of the cases that covered what you asked about, not the whole record. When a case says one value twice, the row keeps the site that said it first. The `afterEach` warning, the invalid-value warning and the misplaced-call error name the call site from the checkout, as the row does, under every host that knows the checkout, including a runner built on `@variance-authority/sense/runner`.
- 9bb6f47: A moved identity names only the fields that differ

  When the baseline was painted under another identity, the `because` sentence
  names only the identity fields that differ between the baseline and this run,
  and says whether they are the machine (renderer, engine, platform, scale, fonts)
  or only variance-authority's recipe (the stabilization or rasterization digest).
  `recipeOnly`, exported from `@variance-authority/raster`, answers which.

  An observation from `@variance-authority/observe` carries `signals.document`,
  saying whether the document is the one the baseline was painted from, so a
  recipe change over an unchanged document reads apart from one that moved the
  page too. `signals.pixels` is optional, since a subject that occupies no pixels
  has none to measure; TypeScript code that reads `Observation.signals.pixels`
  must handle it being absent.

  `variance ask summary` prints a reason that several subjects share once, with a
  count, and lists the subjects under it, so an upgrade that moves every subject
  reads as one line rather than one per subject. It groups the same way the
  pull-request comment does, through `byReason`, exported from
  `@variance-authority/report`.
- ef496ad: READMEs name what the program does

  The package READMEs, and the `@variance-authority/vantage` and
  `@variance-authority/playwright-test` descriptions, no longer write a test, a
  record or a run as something that says, asks or knows. Each sentence names what
  the program does: a command prints, a record holds a field, a test runs or
  covers. Where a value is filled in from configuration or a default rather than
  recorded, the README says so. Four renamed headings change their anchors:
  `help`'s "Where the declaration is undocumented", `playwright`'s "Where a
  component is declared, read from the engine", `storybook`'s "What a pass sends
  the preview" and `sense`'s "Correct what a file's text declares it imports".

## 0.14.0

### Patch Changes

- 644520a: `variance_locate` and `variance_composition` name the run that has no lexicon or composition by what it read, not by its retention

  A run writes its lexicon and its composition whenever its collector gives a semantic snapshot, whatever its retention. When a report has neither, `variance_locate` and `variance_composition` said the run was raster-only or ephemeral. They now say the run read no markup: a raster-only capture, or a run whose collector gave only images. `variance_composition` also names the other report with no composition, a report merged from shards, instead of saying that no subject gave a snapshot.
- a7e7c9e: A changed subject with no difference shape is explained by what the run read, not by its retention

  A run fingerprints the regions of a changed subject whenever its collector gives a semantic snapshot, whatever its retention. When a subject has no shape, `variance_changes`, the PR comment and the review service's changelog page said the run compared without a document, in the ephemeral mode or on a raster-only path. They now say the run read no markup for that subject, or only its accessibility tree changed.

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

### Minor Changes

- 947337c: A test-selection recording keeps each test file's and each test case's duration as its runner reported it

  The coverage file gains a `tests.duration` column: the whole milliseconds Vitest, Jest or Rstest reported for the file, or the `duration` you pass to `startRecording().finish()`. The case index gains the same column for each case: Vitest's task result, Jest's assertion result, Rstest's test result, or the `duration` of a case in the `cases` you pass to `finish()`. A file or case the runner reported nothing for has no duration, never zero, and recordings written before this open with every duration absent.

  `variance ask slowest-tests` (`docs_slowest_tests`) lists the files, then the cases, the latest recorded run spent longest in. `--from <path>[,...]` keeps the tests declared under those paths, `--to <path>[,...]` keeps the tests the recording says entered code in them, and the two combine; counts are within that scope, a `to` path the recording has no row for is named as unrecorded, and a path in neither the recording nor the checkout is refused with the nearest recorded path. `recordedDurations` and `recordedPaths` in `@variance-authority/sense` are the reading behind it. `didYouMean` and `nearest` move to `@variance-authority/mcp/tools`, so both binaries suggest a name the same way.

## 0.9.0

### Patch Changes

- 47e6664: What the CLI, the MCP tools, the servers and the GitHub action print is shorter. An explanation that repeated on every row now prints once, as a header or on the first line that needs it. The reasoning behind an answer stays in the source and is no longer printed. The source snapshot footer is one line, `Snapshot <time>.`

  A changed file in a language the verdict does not read, such as Rust or Python, now reads as `unread (not a JavaScript or TypeScript module)` instead of as a file that does not parse. It is charged the same way.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.7.0

### Patch Changes

- 846ab0d: A source index written before package names joined its dictionary could name a package after the file's first relative specifier. A package imported only by subpath, such as `@variance-authority/core/segment`, had no string of its own in the segment, and its id became row 0: whatever sorted first, which is usually a `../` request. The graph then held a package node called `../exit.js` whose importer never wrote `exit`. A cold cache showed nothing, because it encoded again with the fixed build. The index is now format 9, so every older segment is rebuilt rather than trusted. A decode refuses a stored package name that `packageOf` would not produce, and reads the segment as damaged. The source index, the execution indexes and the MCP source tree now intern through `intern` in `@variance-authority/core/segment`, which throws on a string the dictionary never collected rather than writing row 0.

## 0.6.0

### Minor Changes

- 03984ae: A file whose imports could not all be read no longer widens selection

  A `require(name)` or `import('./' + name)` has no written target. The walk uses
  the edges that were read in such a file, and the recorded run answers the one
  that was not: the module loads under the test however it was named.
  `affectedBy` seeds only the changed files, the closure digest does not mark such
  a file volatile, and it does not void a deviation baseline.

  Removed, not kept as aliases: `Affected.opaque`, `Hole`, `ReachReport.opaque`,
  `ReachHole` and `ReachedComponent.throughUnread`.

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

### Minor Changes

- 8e2a8e5: One connection answers about the run and about the code

  `variance serve` served the report tools and nothing else. An agent in a
  workspace that already had the CLI still had to configure
  `variance-authority-help` as a second MCP server to ask what a package
  publishes or where a name is declared — and that second server was the only
  place a start point could be said at all, because `serve` passed no checkout
  root, so `from` and `to` were refused over the transport the workspace was
  already using. The six source questions had been on `variance ask` since the
  fold began; the fold stopped at the shell.

  Both tool sets now mount over one composite subject, so `tools/list` on
  `variance serve` returns the twelve questions about the run and the six about
  the source, and the six read the checkout the server was started in. Which
  half is read is decided by the question: a report is a file and is re-read on
  every request, a workspace reading is a scan and happens only when one of the
  six is what was asked, so a connection that never asks about the source never
  pays for one.

  Two options on `serve` in `@variance-authority/mcp` carry that, and are useful
  to anyone hosting these tools over more than one subject. `subject` is now
  handed the name of the tool a request calls, where it calls one, so a host can
  read only the half the question needs. `remember` says what is worth keeping
  for the next request, in place of the default structured clone of the whole
  subject: the one tool that compares this request with the last one compares
  reports, and cloning a whole workspace reading on every successful call would
  buy that comparison nothing.

  `@variance-authority/help` is unchanged as a package. What changed is what its
  pages say: a workspace that has the CLI needs nothing from it over either
  transport, and the standalone binary is for the workspace that runs no visual
  suite.

## 0.4.1

### Patch Changes

- Say who expands the query

  `variance_locate` and `docs_search` match the words they are given and expand
  nothing: no thesaurus, no stemming past a trailing plural, no model. That was
  true before and said only in the source, so an agent holding `auth` against a
  repository that writes `CredentialGate` read a miss as an absence rather than as
  a wrong vocabulary, and asked the same question again in longer words.

  Both tools now say it in the description the caller reads, and both skills say what
  to do instead: ask again in a different kind of name — what the screen says, what a
  component is likely called, the file it is likely declared in — rather than a
  reworded description of the same thing. The caller holds the ticket and the
  codebase the word came from, which is the context a shipped synonym table would
  be guessing at.

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
- ff718d3: Distil one test to the behavior it witnesses.

  `@variance-authority/distill` combines an Eyes attention journal and a Sense
  execution index by exact test identity. It keeps authored Arrange, Act and
  Assert attention, React update initiators, and whole-test source entry separate,
  then names entered files without addressed source attribution as opportunities
  for a counterfactual check rather than safe mocks.

  `variance distill` reads the portable files from a shell and can emit text or
  JSON. A combined MCP connection exposes the same analyzer as
  `variance_distill`; the former `variance_testing_surface` name is replaced.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

### Minor Changes

- 1d402d1: Carry the narrowing coordinate in the report, and print it in the summary header.

  A `RunReport` now holds `narrowing`: the ref the run was told to observe from,
  and where the recorded execution index stands — the commit it was written at and
  how many files the working tree differs from it by. A run that narrowed nothing
  carries the second half alone, so the coordinate is present whether or not it was
  spent.

  `variance_summary` prints it. Narrowing is an option and stays one; what this
  refuses is the state where an agent works against a suite for weeks without ever
  learning that an index is on disk and that the distance from it is a number. The
  line names the commit and spells out the `variance run --since` that would use
  it, and is omitted when there is no index, no position, or no distance.

  `run` takes the coordinate as `index` and acts on it for nothing else.
  `narrowingFor` resolves `since`, `against` and `index` together, so a caller
  assembling a run reaches one call rather than three.
- 26ae9ed: Distinguish the React component instance that initiated a commit from every
  component whose render body ran because of it.

  The commit tap retains `memoizedUpdaters` as bounded structural component paths,
  and Eyes records those commits in the authored test chronology. The MCP testing
  surface places update initiators inside or outside the component paths a test
  addressed while keeping whole-test source execution separate.

  Export bounded read-only Fiber subtree, parent-chain, component-path, and source
  location helpers for diagnostics that already hold a Fiber.
- a87d008: Hold what a running suite is saying in a process an agent can ask, so a test in
  flight is something to look at rather than something to wait for.

  A suite already knows what nothing outside it can see: which realms answered and
  in what order, which work began and never finished, that a service is plainly
  talking while the test hearing it hears nothing. All of it is spent settling
  waits and then discarded, so nobody can ask it while it is true. A runner's
  timeout reports what a test *wanted* — the last thing the failure knows and the
  first thing the reader already knew.

  `@variance-authority/vantage` is the second reader. A watching process listens,
  the run reports, and the signals live in memory that outlives the test.
  `variance-authority-mcp --watch` is that process for an agent: it prints the one
  line the suite has to be started with, then answers `variance_run_signals` for
  where the run has got to and `variance_test_signals` for everything one
  execution has heard, in order, with the realm that said each and the work that
  started and never ended. Both answer while the test is still running, which is
  the point.

  The address is in the handshake, not only on stderr. A `Served` may carry
  `instructions`, and the watching one does: a set of tools about a run nobody has
  started yet reads as broken, and an agent told the variable after it has started
  the suite has been told one run too late.

  None of it is about visual regression. A test that takes no screenshot reports
  exactly what one that does reports, and a run started without
  `VARIANCE_AUTHORITY_VANTAGE` pays one environment read per worker.

  The medium is the wire the announcements already travel: one participant, `run`,
  and `channelTo` for a participant handed an address rather than sent one.
  `createEventLog` takes `onRecord` and `onRemark`, called at the moment of
  recording rather than at teardown — an answer that arrives when the test
  finishes answers a different question. `varianceWatched` is automatic so a
  listing has no holes.

  Still nothing written down. There is no report directory and no artifact to
  mistake for evidence later; what changes is only how long one execution lasts
  when somebody is watching.
