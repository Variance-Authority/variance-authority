# @variance-authority/cli

## 0.10.0

### Minor Changes

- 6e5d53a: A file-backed baseline store files each baseline under a directory named for the renderer identity that painted it: a digest of the renderer, engine, platform, scale and fonts. That directory is now named `v1-<hex>`. It was named with the digest as written, `v1:<hex>`. NTFS refuses a colon in a file name, so a baseline root that still holds a `v1:` directory cannot be checked out on Windows, and `actions/upload-artifact` refuses to upload it. The render cache, which is in your cache directory unless `cacheRoot` says otherwise, now uses `v1-` for its identity directories and for each entry's file name.

  A store treats `v1:<hex>` and `v1-<hex>` as the same identity and reads both. When `v1-<hex>` has no baseline for a subject, the store looks in `v1:<hex>`. A baseline under another machine's identity, in either spelling, still makes the subject `incomparable`.

  `variance accept` writes each subject it accepts under `v1-<hex>` and deletes that subject's copy under `v1:<hex>`. It does not touch a subject whose pixels did not change, so a baseline that never changes stays under the old name, and the root stays unreadable on Windows until you move it. For each `v1:` directory, `variance doctor` prints how many baselines it holds and the `v1-` directory to move them into. Move the files with `git mv`. Render-cache entries under the old names are never read again, and the sweep every run applies to the cache deletes them.

  `@variance-authority/core/format` exports `digestFileName`, which spells a digest as a path segment, and `digestOfFileName`, which reads a digest back from either spelling.
- 7b431e0: `variance review` says what a change did, after the suite ran it: how each changed module was edited, the changed regions no case covered and those only tests further than one import away covered, the cases added and removed, the changed files the tests declare as preconditions, and the installed packages the lockfile changed. It prints `text`, `markdown` or `json`, and `--out <dir>` also writes `review.json` and `review.md`. The markdown starts with a hidden marker line, so a pipeline edits its own pull request comment instead of posting another.

  Every run of the suite now writes `coverage.runs.json` beside the recording: the commit it ran at, the commit the recording stood at before the runs at that commit, and the test files they ran. A retry or a second shard at the same commit keeps that starting point. `variance review` with no `--since` starts there. `commitRunsFile`, `readCommitRuns` and `landRun` read and write it from `@variance-authority/sense/test-selection`, and `testsGovernedBy`, which names the test files that declare a given file as a precondition, is exported beside them.
- 6b4a6b8: A pull-request comment now groups subjects that have no baseline under one reason instead of listing each subject as its own cause. The reason for `new` and `incomparable` no longer repeats the subject id, which every line already shows: `no baseline under this renderer; nothing to compare against`.

  `variance report --format html --embed-images` writes the report as one file with its images inside it, so it opens anywhere, including on a phone. On GitHub Actions, upload it with `actions/upload-artifact@v7` and `archive: false`, and the artifact link opens the page instead of downloading a zip.

  `variance comment --to-accept <text>` tells the reviewer how to accept in your repository. When `--run-url` is given, the comment links the report and no longer prints the `variance report --subject <id>` command, which needs the report on disk. The GitHub action takes `to-accept` and `report-page` inputs. `report-page` writes, uploads and links that page.

  The comment now fits a phone's first screen: the count, the leading cause and its file, the report link and how to accept, then any font warning as an alert. The causes, the collateral count, what was skipped and what painted the images sit under one `<details>` fold.

  In the HTML report, each subject's commands (`accept`, `again`, `alone`, `report --subject`) sit folded under **Commands for a checkout**, each with a line saying what it does. The mark on a subject whose inspection found nothing reads `no defects found`. On a narrow screen the header scrolls away instead of staying pinned.

  On a phone, the HTML report shows each subject with its reason and images, and nothing else. The grouped changes, region tables, commands, composition, history, settled subjects, what was not observed and coverage stay on wider screens. A line at the top names the ones this report holds, so you know there is more.

  `variance comment --image-root <url>` shows the leading cause's before and after on the comment's first screen, and each further cause's pair in the fold. The address is where you published the report's directory. The GitHub action takes an `image-ref` input that pushes those images to a ref outside `refs/heads/`, as one commit, and links them by that commit.

## 0.9.0

### Minor Changes

- fce1fd6: `variance covering --format refs` numbers each case once and names every range's cases by number

  The table at the end lists each test file once with its cases under it, and a
  range reads `1-5 walked: 1,3-11,2*`, where `*` marks a case that was inside only
  while the module evaluated. The text answer names each test file once, prints
  a case's id only when it is not the file and the name, and a range walked by
  cases already listed points at the range that listed them.
- be8f5fa: `variance covering --since <ref> --against <record>` says which regions a change's tests moved

  Two case indexes are compared region by region, and each region whose cases
  moved is lost, hidden, thinned or gained. Each test file says how many regions
  it now enters and no longer enters. The files the base branch changed after the
  base was recorded are left out and named. `--cases last` makes the same
  comparison against the cases the last run replaced. `--format refs` names each
  moved region's cases by number. `caseMotion` in
  `@variance-authority/sense/test-selection` is the comparison, and each region
  carries the cases at both ends as the records hold them.
- 2f0b151: A changed JavaScript or TypeScript file whose edit is a comment, a type or formatting no longer seeds the file-graph walk. `variance reach` leaves it out of the list and names it on stderr, and refuses a diff made only of such files. `variance run --since` reaches no component through it and no longer runs the whole suite over it. `runsAsBefore` in `@variance-authority/sense/test-selection` reads, for each file of a diff, which of its exports changed since a commit; an empty list is a file that runs what it ran.
- b48283a: `variance covering` names a line's test files with their share, and `--hops` orders them nearest first

  A line or function answer carries `files`: each test file once, with how many of
  its cases went through the line out of how many it declares. `--hops` adds each
  file's import hops and sorts the files by them, so an editor can list thousands
  of cases as a few hundred files, the nearest on top.
- 9b0c94d: `variance covering --cases last|<test file>` answers from the chosen cases instead of the whole suite

  `last` is the run that wrote the case index last. A test file is every case the
  index holds for it. The answer starts by saying which cases it was read from,
  and `--format json` names them under `scope`. `caseLayerFiles` in `@variance-authority/sense/test-selection` names
  the files beside the index that record the last run and what that run replaced.
- 2958674: `variance reach` and `variance run --since` walk from the exports a JavaScript or TypeScript edit changed, not from the whole file. A file that imports only exports the edit left as they were is not reached, and a barrel passes each changed export on under the name it republishes it as. Stderr names the changed exports of each file, and `variance reach --format json` lists them under `exports`. A namespace import, a `require`, a dynamic `import()` and an import that binds nothing are still walked whole. `affectedBy` in `@variance-authority/core/relate` takes `moved`, the exports each seed changed, and `relationsOfFiles` takes `uses`, the names each import binds; `readPublishedSources` in `@variance-authority/sense` returns that lookup, read from the parses the index already stores.
- 665b527: `variance reach --whole-files` walks from every changed file whole without reading the edit, which is the list a file-by-file import graph gives. It is never shorter than the default list, so running both shows what the reading left out. Its JSON has no `quiet` and no `exports`, because no edit was read.
- 93d53c8: One `variance-authority` skill ships in `@variance-authority/cli`, with a reference file per question, and `variance doctor` says whether your agent can find it

  The skill lives at `skills/variance-authority/`, where skill finders that read
  `skills/<name>/SKILL.md` see it. Its `SKILL.md` routes each question to one file
  under `references/`: reading a run, locating a subject, a live run, producers,
  covering, test selection and its wiring, distillation, the workspace API and
  MCP. It now also holds the test-selection guidance that shipped in
  `@variance-authority/sense` and the workspace-API guidance that shipped in
  `@variance-authority/help`; neither package ships a skill any more.

  `variance doctor` looks in `.agents/skills` and `.claude/skills`, in the project
  and your home directory, and reports each shipped skill as a link, a matching
  copy or a stale copy. For a skill it cannot find, it prints the `ln -s` that
  would serve it. It writes nothing, and the finding never changes the exit code.

### Patch Changes

- f7e5b66: `variance select --execution` reads each changed module from both of its texts before charging its lines, as a selection from the snapshot already does. A comment added above a function sits between two declarations, in the region the module ran as it loaded, and it was charged to every file that imports the module: one comment in a widely imported file selected thousands of test files where the runtime change beside it selected six. The old text is the blob the patch names. A change that proves to run nothing now charges nothing, and one that leaves what the module does as it loads charges only the functions its lines fall in. A patch without `index` lines is charged by its lines, as before, and `select` prints each file's reading.
- aa57273: `ask uses` finds a name your code reads off `import()` or `import * as`. It used to answer that nothing imported `narrowByJourneys` when `select-command.ts` read it as `selection.narrowByJourneys` after `const selection = await import(…)`. Such a site now names the line that loads the module, and an `import()` site says the module loads when that call runs, not when the file loads.

  The parse carries these reads as `members`, apart from each request's `bindings`, so test selection reads exactly what it read before. The source index moves to version 12 and the help snapshot to version 3, and each is rebuilt on the first question after the upgrade.
- 1c5f88c: `variance covering --format json` names an unrecorded project as `{"refused":"unrecorded"}` on stdout

  A project no run recorded is refused with exit 2 as before, and the sentence
  still goes to stderr. An editor asking on every edit reads the kind, stops
  asking in that project, and asks again when the window comes back to the front.
- 47e6664: What the CLI, the MCP tools, the servers and the GitHub action print is shorter. An explanation that repeated on every row now prints once, as a header or on the first line that needs it. The reasoning behind an answer stays in the source and is no longer printed. The source snapshot footer is one line, `Snapshot <time>.`

  A changed file in a language the verdict does not read, such as Rust or Python, now reads as `unread (not a JavaScript or TypeScript module)` instead of as a file that does not parse. It is charged the same way.
- 990ac1a: The agent skills name the commands that ship

  The test-selection skill no longer says there is no command line: it routes
  to `variance select`, `reach`, `index` and `covering`. The CLI skill lists
  every command that reads no config, and covers `covering --hops`, `--cases`,
  the per-file rows, `gained` motion and the `unrecorded` refusal. The workspace
  skill names `variance ask` as the same six questions.
- b1ee579: The `variance-authority` skill's description is one line that names the CLI, so an agent opens the skill whenever it is about to run `variance`. The documentation gives the lines to put in `AGENTS.md`, which an agent reads every session, to send it to `variance ask` before it searches the code, and the link Claude Code needs in `.claude/skills`, which it reads instead of `.agents/skills`.
- 743385a: A file resolves under the `customConditions` of the `tsconfig` that governs it, added to `source`, `import`, `require` and `default`. A workspace whose packages export source under a condition of their own, such as `"@tanstack/custom-condition": "./src/index.ts"` beside an `import` that names built output the checkout does not hold, now has edges into that source, so `variance reach` walks from a changed package into the packages that import it. `extends` is followed the way TypeScript follows it: a config that sets the option replaces what it inherits, and `null` or `[]` clears it. A named `tsconfig` supplies its own conditions, and `conditionNames` you pass stay the whole set. Stored records are read again once, because the conditions a record was resolved under are part of its key.

## 0.8.1

### Patch Changes

- 96a50bf: `variance run --since` and `variance select` print one line per changed file saying how it was read, or why it was not, and name each test that loaded it through an import the file graph does not list; `variance select --format json` gives the same readings as `readings`, and `@variance-authority/sense/test-selection` exports the formatter as `readingLines`.

## 0.8.0

### Minor Changes

- e4ee0da: The repository names its cache. Set `cacheRoot` in the `variance.config.json` at the repository root, for example `".variance/cache"`, and every command, every test runner integration and every function that takes a `cacheRoot` option uses that directory. The path resolves against the repository root. Without the key the cache is `$XDG_CACHE_HOME/variance-authority`, or `~/.cache/variance-authority`, as before, so an existing recording stays where it is. The key is read before the environment, so a sandboxed agent that sets `XDG_CACHE_HOME` to a temporary directory no longer splits the recording away from your own runs. [The cache](https://variance-authority.dev/docs/cache) page describes the location, what is in it, worktrees and CI.

  `@variance-authority/sense` exports `cacheRootFor(root)`, which returns that answer, and `CACHE_CONFIG`. `defaultCacheRoot` is removed; call `cacheRootFor(root)`. A `cacheRoot` option now names the variance-authority directory itself, and `test-selection/` is created under it. `testCoverageFile`, `seedTestCoverage`, `readableTestCoverage`, `moduleNamesFile`, `openModuleNames`, `recordStore`, `recordStores` and `repositoryLayers` take an optional `cacheRoot`. An empty or relative `XDG_CACHE_HOME` is ignored rather than resolved against the working directory. A root `variance.config.json` that is not JSON, or whose `cacheRoot` is not a non-empty string, is an error.

  `@variance-authority/cli` accepts `cacheRoot` in the config and in the schema, and refuses it in a `variance.config.json` below the repository root. `variance run`'s render cache and suite indexes are under it. `renderCacheRoot` and `suiteIndexPath` take the config.

### Patch Changes

- 4250eda: Every run records which case entered each region. The `cases` option is removed
  from `withTestSelection` for Vitest, Jest and Rstest, from the Playwright
  recorder and reporter, and from the Storybook recorder: each writes
  `<coverage file>.cases.bin` beside the file-level snapshot, or `executionFile`
  when you name one. A test file that runs in a page is still recorded per file,
  and says so.

  Without `continuations: true`, a file whose cases overlap no longer fails the
  run. It is recorded as a whole, so a change it reaches runs every case in it, and
  the run names the two cases that were open at once.
- 5ecdc81: Selection asks the repository's `package.json` files for `sideEffects`, so a
  module a package declares is charged to every test that loads it or an importer
  of it.

## 0.7.0

### Minor Changes

- 6261ebe: `variance select --execution` traces a changed lockfile to the tests it reaches, and refuses a list of paths.

  A lockfile in the patch is compared as an install: the patch's `index` line names both blobs, git produces them, and every package that resolved differently is walked back through the packages resting on it to the files that import them. Those files' test files run, and so does every case the journey saw enter one of them. A lockfile the patch changes without naming its blobs keeps every test. `narrowByJourneys` and `selectJourneyFile` take the moved names as `packages`.

  A journey file selects by changed lines, so `git diff --name-only` handed to `--execution` is refused with a pointer to `variance reach`, which answers a list of paths from the import graph.
- dfab8cd: `variance select` reads a journey file against a change you hand in

  `variance select --execution journeys.bin` names the test files a change can
  skip, read off the journey file `journeys finalize` or `journeys stitch` wrote.
  The change comes from `--diff <patch>`, from `--diff -` on stdin, or from
  `git diff` against `--since`. A patch with hunks selects the cases that entered
  the innermost function holding each changed line. A case's crossings into a
  module it mocks do not select it.

  The reading happens in the native addon: `selectJourneyFile` answers a stitched
  file of hundreds of millions of crossings in milliseconds, where decoding it in
  JavaScript ran out of heap. `projectJourneyFile` returns only the regions a
  change lands on, and `variance covering --execution` reads through it.

  `variance covering --since <ref> --execution <journey-file>` diffs from the ref
  you give. It used to diff from the commit of the recorded snapshot, which a
  journey file does not have.

### Patch Changes

- 3dc39cc: A mock no longer disowns what a case crossed. The runner installs a mock before the file's first case, so every crossing recorded inside a case or a hook ran the real module and selects that case, even in a module its file mocks. A mock still cuts what ran only while the module was evaluated, which is how a runner shapes an automock.
- 46f513e: A changed `package.json` is set aside only when the install comparison reads all of its change. A diff that moves `exports`, `imports`, `main`, `module`, `browser`, `type`, `sideEffects`, `name` or any field outside the dependency and publishing fields selected nothing and printed that the diff changed only manifests, while every importer of that package now loaded a different file. Each changed manifest is now read at both revisions, and one that moved a field the lockfile does not hold makes its package a changed directory: the walk reaches every importer, and a journal read charges every file of the package whole. `manifestMoved` in `@variance-authority/sense/lock` owns which fields the install speaks for.
- a006512: `run --since` observes a subject the recording saw enter the change

  A subject could be skipped by what its baseline names and the imports the file
  graph could read, even when the execution record showed that it entered the
  changed lines. That happened in two cases: the chain to the change ran through
  an import the scan could not read, or the baseline did not record the component,
  which is always true of a server component. The recording was consulted only
  about the subjects that survived the first check, so it could not keep this one.

  A subject that the recording saw enter the changed lines is now observed,
  whatever its baseline names, and the run names every subject it kept this way.
  The recording still rules out only subjects that passed the first check.
- a2dac26: The scan now records what each file mocks in its parse, in both the JavaScript and the native reader. It does not apply the result: records keep every edge, including type-only and mocked ones, so a question such as which files a test imports gets the whole graph. `mockTaint()` gets its answer from the cached parse and no longer opens or re-parses test files, which matters in a repository with tens of thousands of them. A `mockTaint` given its own `callers` asks something the scan did not, so it still reads the file. `files`, `taintFile` and `taintTable` work as before. `updateSourceIndex` no longer runs a separate taint pass. The source index is now format 10, so an older segment is rebuilt rather than read without its mock columns. The module reader no longer treats a computed member (`vi[mock]`) as a mock, or a computed `['spy']` key as `{ spy: true }`.

## 0.6.0

### Minor Changes

- 1b4c0db: A changed file the record has no row for no longer runs the whole suite

  A changed path the record has no row or declaration for, and the graph does not
  list — a README, a fixture a test reads with `fs`, a script a test spawns — is
  listed in `unread` and selects nothing by itself. `unread` is a report: the skip
  list is `whole` less `entered` whatever it lists. `variance select` and
  `variance run --since` name those paths on stderr, and `variance select --format
  json` lists them under `unread`. A file the suite rests on without importing it
  goes in the `preconditions` option of the Vitest, Jest or Rstest integration,
  and a change to it then selects every test that declared it.

  A changed module with no instrumented row under any of its names — one the
  recording did not instrument, or one added since it — is walked to the files
  that import it along every runtime edge, never `type`, and each chain stops at
  the first test file or instrumented module it reaches. A module with a row but
  no probes is walked past, and the tests that declare it are selected. A test
  that mocked the changed module, or a file between it and the row, is cut. A
  stylesheet, image or JSON file is walked along `asset` edges, as before.

  Each importer answers for itself. A changed file whose importers the record
  measured only in part selects the tests of the measured ones: an importer with
  no row selects nobody and no longer voids what the chain beside it selects. A
  file known under two names, its source and its built twin, is answered when
  either name has a row, and each name selects the tests recorded under it.

  A bumped package is never `unread`. It is walked to every file that imports it
  at any distance; the measured ones select their tests, and one the record never
  measured selects nothing. Declaring that file as a precondition does not change
  this: a precondition selects on a change to the declared file's own text, not on
  a bump beneath it.

  `variance select` compares the install. It reads the lockfile at the diff's base
  and in the working tree, answers a bumped package through the files that import
  it, and declines to narrow when the lockfile cannot be compared. The lockfile
  and `package.json` are left out of `unread`, because the comparison has already
  said what moved. `variance run --since` reads the execution journal after the
  baselines and the file graph, and narrows past their whole-suite answers, except
  after a change to a `source.before` entry or an install it could not compare:
  the journal never saw either, so the run stays whole.

  `foldTestCoverage` keeps the instrumented rows where shards disagree about
  whether a module could be read. The tests another shard watched run that module
  keep their crossings and stay whole, rather than being demoted to incomplete and
  running at every selection; the tests that loaded the uninstrumented copy
  already declare it as a precondition.

  A workspace package imported only with `import type` is not a runtime import.
  The native scan records a package edge beside an unresolved bare specifier, with
  the kind it was read as, the way the JavaScript scan does, so a caller bridging
  workspace specifiers can tell an erased import from a loaded one. The record
  cache is discarded once, so a record the native scan wrote without those edges
  is read again rather than reused.
- c9a35ca: `@variance-authority/core/relate` exports are renamed, and the old names are removed

  The old names are removed, not kept as aliases:

  | Was | Is |
  |---|---|
  | `movedBy` | `affectedBy` |
  | `Reached` | `Affected` |
  | `MovedOptions` | `AffectedOptions` |
  | `movedBefore` | `changedBefore` |
  | `Reach` | `Traversal` |
  | `ReachOptions` | `TraversalOptions` |
  | `Reach.reached` | `Traversal.nodes` |
  | `Reached.reach` | `Affected.traversal` |

  `dependentsOf` and `dependenciesOf` return a `Traversal`, and `trailOf` takes
  one as its argument.
- 8adc864: Code that runs when a module loads no longer counts as covered by every test in the file

  A module's top level runs once per test file, while whichever test is running
  at the time. Before, every test in the file was recorded as covering it, so
  each line at module scope looked as covered as the function bodies in that
  module. The record now marks such a region as loaded and lists no test as
  covering it. `variance covering` works out, from the import graph, which tests
  loaded it, and leaves out test files that mock the module. When no import graph
  names a recorded test, for example a module that runs in the page and that a
  browser spec never imports, `variance covering` prints no tests for it rather
  than an empty list.

  Recordings written by an earlier version still read. Their module-scope regions
  are marked as loaded when the recording already said so, and are unmarked
  otherwise.
- 03984ae: A file whose imports could not all be read no longer widens selection

  A `require(name)` or `import('./' + name)` has no written target. The walk uses
  the edges that were read in such a file, and the recorded run answers the one
  that was not: the module loads under the test however it was named.
  `affectedBy` seeds only the changed files, the closure digest does not mark such
  a file volatile, and it does not void a deviation baseline.

  Removed, not kept as aliases: `Affected.opaque`, `Hole`, `ReachReport.opaque`,
  `ReachHole` and `ReachedComponent.throughUnread`.

### Patch Changes

- 8adc864: `variance covering --since` resolves a symlinked `--root`

  `variance covering --since` resolves a symlinked `--root` before making paths
  relative to it, so changed paths no longer print as `../../private/var/...`.
- 8adc864: `--no-git` reads source from disk, and a scan no longer makes Git fetch in a partial clone

  `variance select` and `variance reach` take `--no-git`: source is read from the
  disk rather than from Git's object store, and Git still supplies the diff. The
  scan walks directories instead of Git's list of tracked files, and cached parse
  results, which are keyed by Git object names, are not reused.

  Without the flag, a file whose object is missing from the local Git store is
  read from the disk. Before, in a partial clone, reading it made Git fetch the
  object from the remote.
- 1b4c0db: A recording made from a package is found from the repository root

  The coverage snapshot, the module-name table and every record store are now kept
  under the repository the directory you pass sits in, not under that directory
  itself. The recorders already wrote there. The readers — `variance select`,
  `variance covering`, the recording position `variance run` reports, and
  `testCoverageFile(root)` itself — used
  the directory they were given, so a suite recorded from a package-level config
  read as unrecorded from anywhere but that package, and a run from the package
  could not find a recording made from the root. `repositoryLayers(root)`, exported
  from `@variance-authority/sense/test-selection`, returns the directories a record
  of that repository lives in. The source index is still kept per scan root.
- 8f65bcf: `variance select` and `variance covering --since` build the file graph, so a change inside a module a test mocked, or behind that mock, no longer selects that test.

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

### Patch Changes

- Finalize and stitch journey artifacts through `variance journeys`

  `variance journeys finalize <journey-file>` seals a Jest run after Jest exits,
  and `variance journeys stitch <shard-file>... --into <journey-file>` assembles
  downloaded CI shards. Both commands work without `variance.config.json`. Sense
  no longer publishes a second executable for these operations.

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

### Minor Changes

- da23004: The per-case execution index is columns, and fits a CI artifact limit

  `cases: true` wrote its index as JSON, one object per crossing. On three real
  projects that measured 31 to 37 bytes per crossing: a suite whose snapshot is
  0.3 MB left a 27.2 MB file beside it, and every CI has a cap on what a job may
  upload.

  It goes through the same column codec the snapshot uses — a dictionary, parallel
  integer columns, zstd run coding — and the same three projects now write 0.46 MB,
  0.46 MB and 0.21 MB. Nothing about the model changed: `decodeExecutionIndex`
  returns the index `encodeExecutionIndex` was handed, field for field, and the
  optional `loaded` keeps the difference between unsaid and denied.

  The default path is `<coverage file>.cases.bin`. An `executionFile` you name
  `.json` is still written as JSON, at the size JSON costs, for a reader that has
  to have it — and `variance covering` and `variance distill` read either, telling
  them apart by the first byte, so a cache recorded before this still answers.

## 0.3.0

### Minor Changes

- fc59417: Both halves must name the same test, and the same root

  `variance distill` joins two recordings that were made by different tools, and it
  joins them on exact equality. Two independent mismatches made that join fail, and
  neither of them said so.

  **The test id.** Sense keys a case by its coordinate — `<project-relative file> >
  <describe path and name>` — because a name is the coordinate. Eyes takes whatever
  id you hand it, and its collision error recommended the runner's own positional
  task id, which is the opposite: unique within a run, and moved the moment a case
  is inserted above it. Follow both pages and the third reading is unreachable, and
  the refusal named only the id you asked for — never the ids it held — so there was
  nothing in the output to compare. The refusal now prints the recorded count and up
  to five real ids beside it, and states the contract. The collision error asks for
  an id stable across runs and unique within one, and names where the journal will
  be joined.

  **The root.** Eyes records source provenance as absolute paths; sense records
  project-relative module files. Compared directly, nothing matched, and *the file
  that was addressed* therefore appeared in *the files with no addressed target* —
  the distillation opportunity list degenerated to every file the test entered,
  confidently and silently.

  `distill` takes an optional `root` (`--root` on the CLI, defaulting to the working
  directory) and reconciles the two shapes against it. Where it cannot, it withholds
  the list rather than printing a wrong one: if no addressed file matches any entered
  module under the given root, the two sides are rooted differently, and the output
  says so and offers nothing. Suffix matching was considered and rejected — it picks
  a winner among plausible matches and hides that it was choosing.

  A withheld list is the reading working. An opportunity list built on a root that
  does not reconcile is not a weaker answer than none; it is an answer that names
  every file you have.
- fc59417: `accept` refuses without a run, and `--help` tells you what each exit code means

  Two ways the CLI left you to guess.

  **`variance accept` before any run crashed.** There was no report to promote from,
  and the failure surfaced as an uncaught exception — a stack trace, from a
  situation that is ordinary the first time anyone uses the tool. It now exits `2`
  and names the path it looked for, the config key that decides that path, and the
  one dead end worth calling out: a `playwright-test` project records through the
  runner and has no report here to accept.

  **`variance <command> --help` printed the global usage.** The per-command block
  existed and the flag was rejected before anything could reach it. Each command now
  answers with its own synopsis and flags, and with the exit codes *that command*
  can actually return. Only `run`, `report` and `adjudicate` can exit `1`, because
  only those three reach the review path; every other command exits `0` or `2`, and
  saying so uniformly would have been wrong for twelve of the fifteen.

  The three codes keep their meanings: `0` nothing needs review, `1` the run
  happened and found something a person must decide, `2` the run did not happen as
  configured.
- 05d6683: Changes before and beyond reach

  A run reads left to right: the harness starts it, the tests enter your code,
  your code goes out into the install and never comes back. Selection lives in the
  middle, and both ends were invisible for opposite reasons.

  The far right already arrived — a package is a node, a bump is a seed, the same
  backwards walk answers it. The far left is this. Nothing imports a
  `vitest.config.ts`, a setup module, a CI workflow or a `.nvmrc`, so no walk
  reaches one and the honest structural answer about a change to one is *no
  component moved*: a skipped suite over the file that decides how every test in
  it runs. A diff that was *wholly* outside the graph already widened. The hole
  was a config edited beside an ordinary source file, where the walk had a seed
  and answered confidently about a change it never looked at.

  `source.before` names those files, repository-root-relative, and a directory
  claims everything under it. What a declaration buys beyond its own name is
  everything below it: `beforeReach` in `@variance-authority/core/relate` walks
  *along* the arrows from each entry — the one question whose subject has no
  dependents — and collects the setup module, the fixture only that setup
  imports, and the packages the environment rests on. The descent stops at the
  first file `source.dirs` already covers, because that file has dependents and a
  change to it is answered exactly by walking them; everything below it is
  reached through it and does not arrive either.

  The two ends meet there. A `jsdom` bump is named by the install comparison,
  reaches `jest-environment-jsdom`, and reaches a config no file in the
  repository imports — a change beyond reach arriving before it.

  `scanRelations` takes `before` to seed those paths by name, since a harness
  lives above every directory a component scan is pointed at. A named path that
  is absent or has no reader is dropped rather than recorded unreadable: an
  unknown file seeds every walk forever, so a typo would otherwise widen every
  run in the repository. A declared entry the graph does not hold contributes
  only its own name, which is the whole answer for a `.nvmrc` and a symptom for a
  harness config, so the run reports it as a note rather than guessing.

  `source.before` requires `source.relations: true`.

### Patch Changes

- f42e141: `select --format vitest` names each file's place on disk

  A Vitest project matches an exclude pattern against its own directory, not
  against the root the record counts from. The exclusions were printed relative to
  that root, so in any workspace of more than one project they matched nothing:
  the command answered, the runner accepted the arguments, and the whole suite ran
  anyway. Nothing failed, which is the worst shape for this to take — a selector
  that is silently ignored looks exactly like a selector with nothing to say.

  `--format vitest` now resolves each path against the root it was recorded from,
  so the argument means the same thing from wherever the runner is invoked. The
  other formats are unchanged: `plain` and `json` are answers for you to read or
  parse, and they stay in the record's own coordinates.

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
- f4b328b: Mainline's evaluation can travel, so the next machine does not derive it again

  A suite index is bytes addressed by the commit they were written at, which is
  exactly the shape a cache already wants. What was missing was anywhere to put
  them: every checkout that wanted to know what `main` looked like had to run
  `main`, and in CI that is the whole suite, twice, on every pull request.

  `@variance-authority/core/share` is the transport, and it has two backends
  because there are two. A **directory** is what `actions/cache`, `aws s3 sync`, a
  network mount and a laptop all are once the bytes are on disk; an **HTTP
  endpoint** is what a bucket, a presigned URL and a tribunal deployment all are.
  `createDirectoryShare` in `@variance-authority/store/share` is the filesystem
  half, kept out of `core` because `core` takes no platform.

  A share never fails a run. `get` answers `null` and `put` resolves, whatever the
  network did — a share that is down, misconfigured or empty is indistinguishable
  from a cold one, and the run derives its own index and continues. The cost is
  deliberate: a typo in an endpoint is a suite that quietly got slower rather than
  a build that went red, and the `behind` count `variance share` prints is the
  signal that publishing has stopped.

  The CLI gained a `share` section in its config, a `variance share` command that
  says what the share holds for mainline or publishes what this run derived, and a
  line on `variance run` naming where the index went. A lookup walks the lineage —
  `merge-base` with the configured `mainline`, then first-parent — and asks this
  machine's own cache for every commit before it asks the share, because the run
  that just published is usually the one asking.

  `docs/sharing.md` is the arrangement end to end, GitHub Actions first.
- e546e21: A subject with no pixels is a baseline without an image, not a subject that got away

  A wrapper whose only child went to a portal, or a conformance mount with no
  children, occupies nothing. Refusing to photograph it is right; refusing the
  subject was not. On Material UI's unit tier that was 1109 of 4371 subjects
  reported as unobserved while the capture held their markup, their rules, their
  component hashes and their accessibility tree — none of which was in doubt.

  `Raster` makes the image optional: `bytes`, `width` and `height` are absent
  together or present together, and `pictured` is the one place that narrows all
  three. Absent means *this subject has no pixels*, which is a measurement — it
  never means the image was lost. `occupiesPixels` asks the same question of a
  record read without bytes, which is the only form a sidecar takes. `observe`
  gets a second tier in `unpictured.ts`, where the comparison such a subject can
  still take — document digest, component hashes, accessibility — is the whole
  verdict. `promotionOf` promotes the sidecar alone when there is no `after`,
  because the subject reached a verdict and the only missing half is the one a
  camera would have produced.

  The file-backed store carries the same nullable pair, and with it the split of a
  baseline's two halves into two path prefixes. `identities` scans the record root,
  because a subject with no pixels has no image directory to be found in and the
  sibling scan would otherwise call another machine's baseline new.

  Capture stops handing this to Playwright to fail on. Both screenshot paths used
  to refuse a zero-area subject in terms of their own arguments — the clip path
  with `Expected options.clip.height to be greater than 0`, the element path by
  spending the full actionability timeout and then complaining about visibility —
  so a reader had a component that rendered nothing and a sentence about a
  rectangle. `captureSubject` decides it now, and the renderer names the subject.

  **Operators:** this is schema **18**. `baselines` and `render_cache` drop
  `NOT NULL` from `width` and `height`, shipped as `0016_pixel-less-baselines.sql`.
  Apply it before pointing a CLI of this version at the deployment; `GET /version`
  reports the schema a build expects.
- 53e96ad: `variance push` asks what the deployment already holds, and uploads only the rest

  Objects in a tribunal deployment are addressed by their content, which made most
  of what a push sent redundant without anything being able to notice: a run's
  `before` **is** the baseline that deployment handed it over `/baseline/find`, and
  an unchanged subject's `after` is a second copy of that same picture. Every run
  re-encoded and re-uploaded them, and the second and every later copy landed at a
  key the store already had.

  A push now opens with one `POST /review/have` naming the SHA-256 of every image
  it is holding. Images the deployment can already produce travel as a digest; the
  rest travel as bytes. A suite where nothing moved sends its report and almost no
  pixels, and `variance push` reports how many images it did not have to upload.

  The digest form is re-checked on ingest rather than trusted. A digest this
  deployment does not hold — invented, or collected by retention between the
  question and the build — refuses the build naming the subject and the remedy,
  because the run still has the image on disk and may push it again. Recording a
  subject whose picture is not there would surface as a 404 on a review page days
  later instead.

  A deployment that does not answer `/review/have` gets the push this command made
  before the route existed: larger, and correct. Upgrading the CLI ahead of the
  service is not a breaking change.
- 53e96ad: Say which halves are talking.

  A deployment answers `GET /version` with the wire contract it serves and the row
  shape it expects, and `variance push` asks before it reads a byte off disk. The
  pair is printed on the line the operator keeps, and a difference between them is
  named in a sentence rather than left to be inferred.

  It had to be inferred until now, and it was not. A CLI newer than its deployment
  asks `POST /review/have` which images are already there, is answered 404, reads
  that correctly as *nothing is*, and uploads every pixel it is holding — a push
  that is eight megabytes and thirty seconds instead of a few hundred kilobytes,
  with no error anywhere in it. The same mismatch promotes a retina baseline under
  the run's identity rather than the document's, which presents as a subject that
  stays `new` after an approval the page reported as recorded. Three symptoms, one
  cause, and nothing in the chain could state it.

  `variance --version` prints the tool on its own.
- 0718464: Fold shard snapshots into the one a checkout reads.

  A suite split across CI jobs recorded one execution snapshot per job, and
  nothing shipped could make them one: `mergeCoverage` was reachable only through
  the Vitest seam, layers rather than folds, and no writer was public at all. The
  README said a job combines shards with it, and no job could.

  `@variance-authority/sense/test-selection` now exports `foldTestCoverage`, the
  order-independent union of shards that refuses by name when two were not one
  run, `writeTestCoverage`, the whole-or-nothing writer every seam lands through,
  and `mergeCoverage` itself. `variance journeys` takes shard snapshots as
  positionals, folds them, layers the result over what this checkout already
  holds — or writes it where `--into` says — and reads the suite it just made.
- ff718d3: Distil one test to the behavior it witnesses.

  `@variance-authority/distill` combines an Eyes attention journal and a Sense
  execution index by exact test identity. It keeps authored Arrange, Act and
  Assert attention, React update initiators, and whole-test source entry separate,
  then names entered files without addressed source attribution as opportunities
  for a counterfactual check rather than safe mocks.

  `variance distill` reads the portable files from a shell and can emit text or
  JSON. A combined MCP connection exposes the same analyzer as
  `variance_distill`; the former `variance_testing_surface` name is replaced.
- faec91c: The difference mask is computed on the review page, not uploaded

  A mask is new bytes by definition whenever anything moved, so it is the one image
  content addressing can never deduplicate: `before` is always a hit and an
  unchanged `after` is a second copy of a baseline, but a mask matches nothing and
  never will. `variance push` now leaves it at home. The review surface holds both
  captures and makes its own when a reviewer opens the difference — through the
  same function, at the same policy, so the two cannot disagree about a threshold,
  an anti-aliasing rule, or what a grown capture does to the union box. Builds
  pushed by earlier versions kept a mask and are still served it.

  Runs are unchanged: the report still writes a diff PNG, because that is the
  picture a developer opens without a deployment, and a deployment is optional.

  `@variance-authority/png` gains a `./mask` subpath — the padding rule and the
  difference, over pixels somebody else decoded — so a caller holding RGBA reaches
  the arithmetic without a codec, and a bundler following it finds no `pngjs`.
- e546e21: `baselines.records` puts the sidecars where git is not looking

  A baseline is an image and a record of how it was painted. The image moves when a
  pixel moves; the record moves whenever the *document* does — a class name, a
  build id, a font that resolved somewhere else — so a record committed beside its
  image puts a tracked diff on every edit that moved nothing. At a few hundred
  subjects the baseline directory is the noisiest path in the repository, and a
  directory nobody reads is a directory that catches nothing.

  `"records": ".variance/records"` on a `directory` or `lfs` baselines section sets
  the store's `recordRoot`, and the rule it buys is worth stating plainly: if a
  change did not update an image, it updates no file under version control.

  Unlike `cacheRoot` beside it, this is not inferred. A lost cache entry costs a
  render; a lost record costs the run its `missingFonts` and its `findingMarks`,
  which are evidence a verdict is allowed to turn on — so where they go is your
  decision and the config is where you make it.

  It moves the record's directory and nothing else. Both halves are still written
  and both are still read, so half a pair still stops the run and still names the
  file it looked for, in whichever root it looked in. A repository that leaves
  `baselines.records` unset keeps `*.json merge=binary` as the stopgap it was.

### Patch Changes

- e546e21: A collector's complaints travel into the observation

  A finding produced at collection reached the CLI's record and nobody else. A
  suite driving this from its own runner asks the observation what is wrong with a
  subject, and the one diagnostic that explained the moved pixels — the host, not
  the stylesheet, chose the typeface — was produced, carried, and dropped one call
  short of the person reading the failure.

  `mergeDiagnostics` dedupes on every field, so the CLI, which now meets the same
  list twice, says a shared complaint once.
- 789405d: An `ignored` subject now ships the pair that makes it reviewable.

  `ignored` means pixels differed and every one of them fell inside a mask
  somebody wrote, which makes it the one verdict where the question is about the
  mask rather than about the render. The run shipped only the candidate for it —
  the single image that cannot answer *has this rule grown over a regression*,
  because inside a mask the candidate looks exactly as intended. A `before` and
  the difference mask are written and uploaded for it now, on the same terms as a
  changed subject, and the settled panel links each absorbed row to the page that
  shows all three.

  The browser accessibility snapshot a candidate sidecar could carry is stated as
  the missing acquisition it is, at the site that would have to close it: the CLI
  builds the sidecar from the render cache, which holds the renderer's output, and
  the collector contract has no field for one. The column, the transport and the
  promotion all carry it already.
- c8f0824: An approved candidate becomes a baseline a later run can find

  Every baseline lookup keys on the identity of the document that was painted —
  `identityAtScale`, which folds in the viewport's `deviceScaleFactor`. A build
  row carries the identity of the machine instead, whose own source says nothing
  may key a store on it: a run painting 1x and 2x viewports reports the scale
  there as 1. Promotion used that one. On any suite above 1x the approval was
  recorded, the page said so, and the next run looked under a digest nothing had
  ever been filed under — so the subject came back `new`, forever, and no amount
  of approving it helped.

  So `push` now sends the candidate's own sidecar identity, the service keeps it,
  and a promotion files under it. A push that predates the field still promotes
  under the build identity, which is what this did for every build and is correct
  at 1x.

  `components` and `findingMarks` travelled the same way and did not survive: the
  sidecar carries them, the request dropped them, and a baseline promoted through
  review came back without. Both describe the document that painted the image, so
  nothing downstream can recover them from the bytes — without the hashes a later
  run ranks causes by area, and without the marks it reports every standing defect
  as one the change under review introduced. Absent and `[]` stay apart end to
  end, because nobody having looked is not the same fact as having looked and
  found nothing.

  For the same reason `push` no longer defaults a missing `missingFonts` to `[]`.
  A sidecar that never said which fonts were missing now withholds the candidate
  with a sentence naming the file, rather than promoting a baseline that claims a
  font check it never ran.
- 53e96ad: `variance push` says where it is while it is there

  A push of a real suite spends most of its wall clock before the request exists:
  every image the report named is read off disk and base64-encoded into one body,
  and a few hundred subjects of that is tens of seconds of a command that has
  printed nothing. Silence there is indistinguishable from a hang against an
  address that is not answering, and the two call for opposite responses — wait,
  or interrupt and check the endpoint.

  So the two phases report themselves, on stderr, in the shape the reader is in.
  A terminal gets one line rewritten in place, cleared before the report lands on
  stdout. A log file gets one line per phase and nothing per subject, because a
  build log is read afterwards, where every intermediate count is noise.

  `sending` carries a size and no progress, which is the truth about it: the body
  is one POST, and the number that explains the silence after it is how large that
  body turned out to be.

  `PushOptions` gained an optional `onProgress`, and nothing computes an event for
  a caller that did not ask for one.
- e546e21: Four ways a large unit tier lost subjects, none of which said so

  **The styling was gone before the capture looked.** A capture taken from a setup
  file runs in the outermost `afterEach` a run has; every hook registered inside a
  `describe` has already finished, and `onTestFinished` runs later still. CSS-in-JS
  teardown lives in exactly those inner hooks — emotion's test renderer removes each
  `<style>` tag it inserted — so the capture read the page with the styling taken
  back off it. The class names were all still in the markup, they matched nothing,
  and every subject captured, compared and passed against a photograph of unstyled
  DOM. Measured on Material UI's unit tier: 399 of 400 captures carried no CSS at
  all, and 1201 subjects laid out to zero height because nothing was sizing them.
  `retainStyles` records style elements as they are inserted and puts the removed
  ones back, in insertion order, for the length of one capture. The next test still
  gets a clean page.

  **A subject id can be longer than a filename.** A suite that names subjects after
  the test that produced them — a file path and a full test name — passes 255 bytes
  on ordinary tests, and the point of that convention is that the id says where the
  subject came from. `fileNameFor` in core is now the one rule: a readable prefix,
  plus a digest of the whole id when the id does not fit, because truncation alone
  merges two tests into one file. The baseline store, the capture archive, the
  CLI's image directory, the Playwright evidence directory and the Eyes journal all
  use it; before this, each was one long subject id away from a raw `ENAMETOOLONG`
  that never mentions a subject. `@variance-authority/eyes` declares
  `@variance-authority/core` directly rather than reaching it through `react` — the
  host stacks it keeps optional are Playwright and Testing Library, and a filename
  rule is not one of them.

  **An inline `url()` is spelled in entities.** `style="background-image:url(&quot;/a.png&quot;)"`
  reaches the scan through HTML serialization, and reading it literally asked the
  caller for bytes at a URL that exists nowhere but in the escaping. The HTML half
  is scanned with the attribute's entities undone; the stylesheet half, which was
  never escaped, is scanned as before.

  **A stubbed `getComputedStyle` is not a broken asset scan.** Replacing
  `window.getComputedStyle` with a map of the two properties a component reads is
  the only way to drive some layouts in jsdom. The scan called `getPropertyValue`
  on the plain object it got back, and every test in the file died on a `TypeError`
  raised four frames below anything you wrote. There is nothing to scan and nothing
  to complain about — whatever those styles would have named, the stub already
  removed from the page. The attributes on the element are still read.
- 0718464: A changed file no probe can sit in is asked of the module that imports it.

  The record decides what a change reaches. A module nobody executed — every
  test that imports it mocks it, or nothing loaded it — has no row, and the tests
  that import it never ran a line of it: it selects nobody, and so does everything
  only it imports. A stylesheet, an image, a JSON file can hold no probe, so it
  never has a row, and whether a test ran it is a question about the module that
  imported it. `narrowByExecution` and `selectTestFiles` now take `relations` and
  walk from every changed file through `asset` edges — the stylesheets that import
  the stylesheet, the modules that import those, and no further — and select the
  tests that entered each module reached; a module reached without a row is dead.
  A file whose own edges the scan could not read may reach the asset by an edge
  nobody saw, so its tests are selected as well. `knownAs` looks the changed file
  and every module reached up under every name the journal holds them by. `unread`
  names the changed paths nothing recorded holds — no row, no precondition, no
  place in the graph — as a report rather than a widening: a suite that depends on
  a file that way declares it as a precondition.

  A diff is read the way `git` writes it. A pure insertion is placed after the
  line it follows, additions past the count of lines they replace are charged to
  the gap they open after the last one, a file the diff names without a hunk — a
  binary, a rename, a mode change — is charged whole, a quoted path is decoded,
  and the narrowest region on a changed line is measured over regions that have
  source, so the `else` nobody wrote never decides a line alone. A module the
  runner evaluates again after a registry reset keeps what it counted before it,
  a module a runner shares across files without isolation is counted for every
  file that consumed it, and what a module did while evaluating is credited to
  the files that entered it rather than to every file the run ran; a file that
  only reads a module another file evaluated is reached through `relations`. A line that
  opens or closes the narrowest region — the condition of an `if`, the props
  beside a one-line handler — is the enclosing region's line too, and charges it.

  The CLI's `--since` lists files from the merge base of the ref and `HEAD` to
  the working tree, untracked files included, so a branch behind `main` is not
  charged with what others merged and a watch loop is asked about the edit that
  was just saved; the hunks the journal reads are taken from the commit the index
  was recorded at, whose coordinates are the only ones its line ranges are in;
  a module the run did not load, carried from an earlier recording, has its text
  on disk compared with what its rows were recorded over, and every test that
  entered a module that has moved is marked partial rather than left standing on
  lines that are no longer there. A rename's hunks are read under the old name.
  Paths are read unquoted and under `a/` and `b/` whatever the operator's git
  configuration says, and the index is looked for at the repository root as well
  as the run's directory.

  The Jest seam instruments every project of a `projects` configuration and
  leaves a setup entry that names a package out of the preconditions; the Vitest
  seam does the same for its setup entries.

  The runtime's counter factory is installed before the project's own setup
  files — first in Vitest's `setupFiles`, and in Jest's `setupFiles` rather than
  `setupFilesAfterEnv` — so a setup file that loads an instrumented module finds
  it. Jest projects that name `@variance-authority/sense/jest-setup` by hand keep
  working; it installs the factory itself when nothing has.

  Every selection now says why. `because` names, per selected test, the changed
  region it entered, the precondition it is governed by, or the trail of importers
  it was found through. The CLI's `--since` hands its `relations` scan to the
  journal reader when the config asks for one.

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

### Patch Changes

- 355e668: Stop labelling a changed region with the path of the node that contains it.

  A page this project did not write in React carries no component names, and both
  docket renderers fell back to the containing node's path. A pull-request comment
  led with **`0/1`** in code voice, and a failing Playwright assertion printed
  `1510px — 0` three times, the three rows separated only by their pixel counts.
  Where no component and no landmark phrase exist, both now print the region's
  geometry, which at least finds the rect in the diff image. Collateral counts only
  regions that have a component, so a page with none no longer reports "in 1
  component(s)".
- 9dfa2bd: Run when invoked through the symlink a package manager installs.

  `npm install` writes `node_modules/.bin/variance` as a link into the package, so
  `process.argv[1]` is the link while `import.meta.url` is its target. The
  main-module guard compared the two as written, which is true only when the file
  is run by its own path — inside this repository. Installed, `variance run`
  evaluated the module, dispatched nothing, and exited `0`: a gate reporting
  success without opening a browser. Both executables now resolve each side
  through `realpath` before comparing, and `tools/bin-symlink.check.ts` runs every
  declared bin twice, by path and through a link, and requires the two to agree.
