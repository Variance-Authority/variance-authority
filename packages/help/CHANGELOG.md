# @variance-authority/help

## 0.14.0

### Patch Changes

- 58d3332: The help server and `variance serve` describe every source question they answer

  `variance-authority-help --help` said `serve` answers "all six" questions, and the instructions `variance serve` sends an MCP client said "nine"; both serve eleven. Neither states a count now, and the `variance serve` instructions name the two they had left out: which third-party packages a location can use (`docs_stack`) and which code the recorded tests ran around a file (`docs_journey_map`). The verb list in `--help` is padded to its longest verb, so `slowest-tests` and `journey-map` no longer run into their descriptions.

  The READMEs of both packages link the documentation on variance-authority.dev instead of a repository-relative path, which does not resolve where npm shows them.

## 0.13.0

### Minor Changes

- ebbec80: A call the source leaves short is placed from what the case ran, and no test runner's config is read

  The journeys walk no longer reads Vite's or Vitest's `resolve.alias`. When an import resolves to no function, the walk places the call on the one function the case entered that a file of the checkout exports under the imported name. That is the default export for a default import, and the member for a call through a namespace import. When the import names a workspace package, the function must be exported from that package. An import of a Node builtin, or of a package a manifest declares and no workspace holds, is never placed this way. When several entered functions match, the call is reported as ambiguous, and the walk's other inferences still get a turn. An import that resolves to a function the case did not enter stays where it resolved. `variance index` counts both outcomes in its journeys line, and the orient legend names a recorded caller.

  `@variance-authority/sense` no longer exports `runnerAliases`, `runnerConfigs`, `runnerDigest`, `keptRunnerAliases`, `unlistedRunnerAliases`, or the types `RunnerAlias` and `RunnerAliases`. `NativeJourneysPrepared` loses the `aliased` and `runnerUnread` fields, and `prepareJourneys` on the native binding takes the Node builtin names as a new last argument.
- 573afba: A third-party name in `ask search` and `ask symbol` says whose manifest offers it

  Each installed third-party name in a `variance ask search` answer gives its version, the manifest that offers it, how that manifest declares it (`dependency`, `optional`, `peer` or `dev`), and how many times the code under that manifest imports it, with the first import as `file:line`. `variance ask symbol` prints the same line above the declaration. With `--from` or `--to`, `ask search` offers a name only when the manifest that owns one of those paths declares or imports its package. A package that only another workspace declares is left out, even when the path imports that workspace. When no third-party name matches, the answer says how many packages it searched and under which manifests. The next `variance index` rewrites the dependency lexicon with these fields.
- 573afba: `variance ask stack --from <path>` lists every third-party package a path can use

  It takes no words. `variance ask stack`, and the `docs_stack` tool on the workspace API server, read the manifest that owns the path and list each package it declares or that the code under it imports: the version, the role (`runtime`, `dev` or `types-only`), how the manifest declares it, and how many times the code imports it, with the first import as `file:line`. Imported packages come first, then the ones declared and not imported, then the ones whose imports were not read. A declaration the resolver could not read is listed with the reason. A page is 40 rows unless `--limit` says otherwise, and `variance ask` takes `--offset <n>` to skip rows. Each page ends with how many rows remain and the `--offset` that asks for the next page. The answer reads only the dependency lexicon that `variance index` writes and opens no installed package. `dependencyStackNative` in `@variance-authority/sense` is the call it makes.
- 573afba: `variance index` returns once the source index is written

  Outside CI, `variance index` writes the source index, starts a process of its own for the code map, the journeys, the dependency lexicon and the questions `variance ask` answers from, and returns. Its last line names that process and the log its lines are written to:

  ```text
  follow-ups: the code map, the journeys, the dependency lexicon and the questions are being made by process 48213, and the next variance command waits for it; their lines are written to <cache>/test-selection/<digest>/source-index.bin.follow-ups.log
  ```

  Every later `variance` command waits for that process before it reads anything, and says on stderr that it is waiting. When the process ended before it finished, the next command makes what it left and prints those lines on stderr. In CI, or with `--wait`, `index` makes all four before it returns. `--follow-ups` is what the started process runs, and is refused together with `--wait`.

  The source index is a base and one working layer over it that holds the files changed since the base was written. An update reads again only the files whose bytes changed, rewrites the working layer and never the base, and writes nothing when nothing changed. The started process folds the working layer into the base, writing the two as one new base, once the working layer has a tenth as many records as the base, counting added and deleted files. On Kibana (107,163 files), the update after a one-file edit takes 165 ms over an empty working layer and 220 ms over eleven thousand changed files, and the fold takes 620 ms.

  `prepareCodeMap` in `@variance-authority/sense` and `refreshDependencyLexicon` in `@variance-authority/help` return a promise. `@variance-authority/sense` exports `readySourceIndex`, which folds the working layer into the base, and `@variance-authority/help` exports `refreshWorkspaceFromIndex` and `publishedGeneration`.
- 573afba: `variance ask journey-map` draws the code around a file from the recorded tests that match your words

  `variance ask journey-map --file <path> [--query <words>]`, and the `docs_journey_map` tool on the workspace API server, read the latest recording. They run nothing and open no source. A test is kept when its file path or its name contains any of the `--query` words; with no words, every test that ran the file is kept. The answer says how many recorded tests ran the file and how many were kept, and lists the kept tests smallest first. Then it lists each function of the file with the paths the kept tests took through it. Beyond the file, it lists the functions most kept tests ran, nearest first, and then the functions only some of them ran, grouped with the smallest test of each group. A function beyond the file that at least half of all recorded tests ran is counted and not listed. Every suite with a recording answers under its own name. `journeyMaps(root, file, terms)` in `@variance-authority/sense` returns the map for every suite.
- 573afba: `variance ask orient --files` names the cases that ran a file by importing it, and gives every share and package flow as counts

  The recording credits no case with code that ran while a module was evaluated. For such a file, `orient --files` finds the recorded test files that import it, over the source index, and counts their cases: `5 cases ran it, 3 of them by importing it`. When the source index names no importers, the line says so. In the packages part, every share has its count beside it, and a share over fewer than 10 uses is printed as the count alone, for example `3 of 7`. The package flows of the recorded cases are headed `Observed:` and count the packages each case ran code in together, as combinations and not as calls from one package to another. A `variance ask search` answer that lists exported names ends with the `variance ask orient --files` question for the first file it names. `orientAround` in `@variance-authority/sense` reads the packages and the external dependencies around a set of files in one pass.
- 573afba: `variance ask search` finds an installed package by what it says it does

  `variance ask search --query "state management"` lists, after the name matches, the installed packages that describe that job. When `variance index` refreshes the dependency lexicon, it stores the word stems each installed package uses: from its manifest `description` and `keywords`, its README headings, its package name, and its exported names with the first sentence of their documentation. A package is listed when those stems contain at least half of the distinct stems of the query. A package whose own description, keywords or headings contain them comes before one that matches only through its names. Each row gives the version, the manifest that offers the package and how it declares it, how many times the code imports it, the package's description, and the query words it matched. A question reads only the stored stems and opens no package. A dependency lexicon written before this release answers without these rows until the next `variance index` rewrites it.
- 573afba: `variance ask symbol --from <path>` answers as the workspace that owns the path

  For an installed third-party name, `--from` takes a file or a directory, and the answer uses the manifest that owns it: the version installed for that workspace and the signature declared in that version. Two workspaces that install different versions of one package each get their own signature. When that manifest neither declares nor imports the package, the answer says the name is not usable from the path and lists every manifest that offers it, each with its version.
- 573afba: `variance layers` gives each package its dependency layer and its tier, and against a base names the packages whose own code changed them

  A package that imports no other package of the repository is layer 1. Any other package is one more than the highest layer among the packages it imports. `variance layers` lists every package by layer, read from the code map that `variance index` writes beside the source index. `variance layers --against <index>` compares the checkout with a source index built at a base. It lists each package whose own dependencies changed its layer, with the packages it started or stopped importing, and gives the number of packages that import it and changed layer only as a result. Packages that appeared or vanished are listed apart. The command exits 0 whatever it finds. With `--format markdown` it prints nothing when nothing changed, and its first line is `<!-- variance-authority:layers -->`, so a CI job can post, update or delete one pull-request comment from it. `--format text` and `--format json` are the other two formats.

  Declare `tiers` in the root `variance.config.json` to also place each package by how much code it pulls in. It is a list of line budgets, largest first, for example `"tiers": [200000, 20000, 1000]`. Each entry is one tier, numbered from 0: here tier 0 is 200000, tier 1 is 20000 and tier 2 is 1000. A package is in the highest-numbered tier whose budget fits its size, so a package of 15,000 lines is tier 1 and one of 500 lines is tier 2. Tier 0 holds every package, whatever its size, so its budget only labels it. The size is the lines of code, without blank lines and comments, in the files the package ships and every file they import, through `import()` and through further imports, up to the imports of installed packages. The files a package ships are its files that are not tests and not used only by tests. Type-only imports are not counted. Nobody writes a package's tier down; its imports decide it.

  With `tiers` declared, `variance layers` prints each package's tier, lines and files next to its layer. When part of a package's code could not be sized, such as a stylesheet, a file the index could not parse or an import it could not resolve, the tier prints as `tier ≤ 1`: tier 1 or a lower-numbered one. It names, once, the packages whose manifest has no `exports`, `main`, `module` or `bin` naming a file of theirs, because their shipped code is then taken to start at the files the package's own code never imports. Against a base, it reports tier changes the same way as layer changes, with each package's own lines before and after.

  `variance ask orient` numbers dependency layers from 1. The code map format changes, so a checkout indexed by an earlier version has no layers to read until `variance index` runs again. `packageLayers`, `layerMoves`, `tierMoves`, `declaredTiers`, `parseTiers`, `tierOf` and `tierLabel` in `@variance-authority/sense` are what the command reads.

### Patch Changes

- 3f240e9: `variance ask search`, and any source question asked with `--just-answer`, refuses with exit code `2` when nothing is published for the checkout, and names `variance index` as the command that publishes it. Before, a fresh checkout or worktree printed the refusal as a defect in the tool, with a stack trace under it.
- b3c1bdf: `variance ask uses` and `ask symbol` answer for a name that no entry publishes but that another package imports by the path of its file, such as `addTax` from `@acme/lib/src/internal/math`. They no longer refuse it. Each import is listed with its file and line and marked as a deep import, past the entry the package declares, or as an import by path from a package that declares none. `symbol` also says where the name is declared and why nothing publishes it. A name that is exported without being published and that nothing imports is still refused, and the refusal names the file and line that export it.

  A workspace package with none of `exports`, `main`, `types` or `typings` is no longer skipped. `ask packages` and `ask entrypoint` list it by the files and names other packages import from it, each with the importer's file and line, and none of those imports are called deep. A `.js` `main` with no `types` and no `.d.ts` beside it opens at the `.ts` or `.tsx` source of the same stem, as TypeScript reads it.
- 59be40a: A pnpm workspace's packages open, and `reach` walks past a file the diff deletes

  A root manifest with no `workspaces` reads its members from `pnpm-workspace.yaml`, so `ask entrypoint --package @mui/material` answers on Material UI. The list is read as YAML and its entries as globs, so an entry starting with `!` excludes what it matches, a `**` glob reads every member under it, and a list written at its key's own indent, in flow style or under a byte-order mark reads the same as any other. A member two entries match is read once. A bare `.js` export opens by the `.d.ts` written beside it, and a published name followed through a JavaScript module reads that declaration. A workspace that publishes no package says so in a sentence, where it printed an empty list.

  `variance reach --since <ref>` takes the files the diff deletes out of the walk and names them on stderr. A diff that only deletes refuses, and the refusal names the deleted files.
- 27a4713: An `exports` field written as conditions opens `.`, and a custom condition in `tsconfig.json` is followed

  An `exports` string, an array of fallbacks, or an object with no `.` key now publishes `.`, as Node reads it. Before, each condition key was taken as a subpath, which invented names such as `@tanstack/solid-querytanstack/custom-condition`. An object that mixes subpaths and conditions is refused and the manifest is named, because Node refuses to load it. A condition listed in the package's `tsconfig.json` `customConditions` (through `extends`) is followed to the source it names when it comes before `types`, so Zod's `@zod/source` and TanStack's `@tanstack/custom-condition` open their `src/` files. Every config in that `extends` chain is read as JSONC whatever its name, so a comment in a `tsconfig.base.json` is read rather than refused. A pattern target with no extension, such as `./src/v4/locales/*`, opens one subpath per TypeScript file it matches, spelt with the emitted extension. An import of a subpath that `exports` names exactly is no longer reported as reaching past a published entrypoint when that subpath's source could not be read; it is listed under unreadable instead.
- b2317fa: `variance ask journey-map` says why a file has no map

  When the recording lists nothing for the file you asked about, the answer says why.

  - A test file is named as a test file, with the three modules its recorded tests ran most. Each module shows how many of the file's tests ran it and how many of all recorded tests did.
  - A directory is named as a directory: the map is drawn around one file, so the answer asks for one of the files in it.
  - A path that git does not list in the checkout and the recording does not hold is refused as not in the checkout. The refusal names the recorded path one typo away, as `ask slowest-tests` already does, or else the recorded files with the same name in other directories. A file on disk that git ignores is named as ignored instead.
  - A file that existed at the commit the recording was made at and is gone from the checkout is named as deleted since, from the CLI and from `journeyMap` alike.
  - A file that did not exist at that commit is named as new since the recording.
  - For any other file, the answer says no recorded test loaded it only when git lists it at that commit, the test run instruments files of its kind, and the recording lists other files in the same directory. Files in the directories below do not count, and a file at the repository root is judged by the files at the root. Even then the answer names the one case the recording cannot rule out: a module the test run is configured to leave uninstrumented. Otherwise the answer says the recording cannot tell, and why.
  - The path may be spelled through `..` or from the root of the file system; the map names it from the root of the checkout. A path outside the checkout is refused as outside it.
  - `journeyMap` and `journeyMaps` take the listing `checkoutListing` returns, so a caller that already asked git about the path does not ask again.
  - `ask journey-map` and `ask slowest-tests` share one check for a path that is not in the checkout. It accepts a new file that git lists as untracked and not ignored, which `ask slowest-tests` refused before.
- 2f75494: `ask symbol` answers a re-exported name through the door the workspace imports it by

  When several packages publish one declaration, as every TanStack Query adapter re-exports `@tanstack/query-core`, the answer led with the first package read and its own count, so `QueryObserver` came back as imported from `@tanstack/angular-query-experimental` and "used by nothing outside its own package". The door with the most importing packages, then the most imports, now leads; the others follow under "Also published by".

## 0.12.0

### Minor Changes

- 0d67928: `symbol` names the README of a dependency that ships no declarations, and the passage that names the symbol
- 63751d2: `variance ask orient --files` names the calls into and out of each file

  `variance index` now walks each case of the latest recording over the static call graph and writes the result beside the source index. `orient --files <path>[:<line>]` reads it: for each file, the functions the most cases ran, the functions in other files that call into it and those it calls, each with its case count and how the call is known, and the package flows those cases take through the file. With a line, the calls narrow to the function holding it, and a line written after the recording says so. When the recording or the index changed after the walk, the answer says `not prepared` and why, and never answers from an older walk. The walk resolves an import the way the test runner did, through each Vite or Vitest config's `resolve.alias`.

## 0.11.0

### Minor Changes

- 7556a03: The cache is inside the checkout. Without `cacheRoot` in `variance.config.json`, it is `node_modules/.cache/variance-authority` at the repository root, so a coding agent whose sandbox allows writes only in the working tree records and reads the same cache as your terminal and CI. `XDG_CACHE_HOME` is no longer read; `VARIANCE_AUTHORITY_CACHE`, an absolute path, names the cache directory for a harness that keeps its runs apart. A recording under `~/.cache/variance-authority` is not read, so the first `yarn test` after upgrading records again. `variance index` also publishes the value `variance ask` answers from, so `ask search` answers in a fresh checkout, and prints a `questions:` line saying where it is or why it could not be written. [The cache](https://variance-authority.dev/docs/cache) page describes the order.

  `readWorkspace` in `@variance-authority/help` takes `packs`, whether the scan reads bytes from Git's object store, and `saveIndex`, whether publishing also writes the scan's records back to the source index; `variance index` turns it off, because it has just published that index itself.

### Patch Changes

- 56282b1: `variance index` exits `2` with `source index not written: <reason>, at <path>` when the file system refuses the index, instead of reporting it built. `updateSourceIndex` returns the refusal as `refused`; a scan anywhere else still treats an unwritable cache as a cold next run. A `variance ask` question no longer narrows the source index it reads: a workspace whose path runs through a link, such as a checkout under macOS's `/var`, is scanned whole, and a scan of only some of a repository's directories publishes its answer without writing over the index of the whole. Before, either one could leave `variance select` unable to trace a lockfile bump to the tests it reaches.

## 0.10.0

### Minor Changes

- 947337c: A test-selection recording keeps each test file's and each test case's duration as its runner reported it

  The coverage file gains a `tests.duration` column: the whole milliseconds Vitest, Jest or Rstest reported for the file, or the `duration` you pass to `startRecording().finish()`. The case index gains the same column for each case: Vitest's task result, Jest's assertion result, Rstest's test result, or the `duration` of a case in the `cases` you pass to `finish()`. A file or case the runner reported nothing for has no duration, never zero, and recordings written before this open with every duration absent.

  `variance ask slowest-tests` (`docs_slowest_tests`) lists the files, then the cases, the latest recorded run spent longest in. `--from <path>[,...]` keeps the tests declared under those paths, `--to <path>[,...]` keeps the tests the recording says entered code in them, and the two combine; counts are within that scope, a `to` path the recording has no row for is named as unrecorded, and a path in neither the recording nor the checkout is refused with the nearest recorded path. `recordedDurations` and `recordedPaths` in `@variance-authority/sense` are the reading behind it. `didYouMean` and `nearest` move to `@variance-authority/mcp/tools`, so both binaries suggest a name the same way.
- 25297df: `variance ask orient` takes the files you already have, and searches no text

  `orient --files <path>[,...]` (`files` on `docs_orient`) answers each file in the order you gave it: its package, or that the source index does not hold it, then what those packages take from other packages and what other packages take from them, and the recorded cases that ran each file. `--query` is gone: finding a file is what `search`, `symbol` and `grep` are for, and a call without files names them. Nothing in the answer reads a file's text, so it no longer runs `git grep` over every tracked file once per word.

### Patch Changes

- 68c9240: `export default name` records `name` as the export's `local`, where it recorded `default`. The exported name already says `default`, and the identifier is what joins the default to the file's own declaration or to the import it republishes, through that request's bindings. A default that is an expression or an anonymous declaration still has no `local`. Stored parses are read again once, because the source index they are kept in moves to a new version.

  Help follows `export default name` to its import by that `local`, so a comment between `default` and the name no longer stops it with "no declaration there says what it is". A name the file declares is still answered by its declaration: `export const logger = OriginalLogger` is a `const`, as TypeScript's declaration emit publishes it.

## 0.9.0

### Patch Changes

- aa57273: `ask uses` finds a name your code reads off `import()` or `import * as`. It used to answer that nothing imported `narrowByJourneys` when `select-command.ts` read it as `selection.narrowByJourneys` after `const selection = await import(…)`. Such a site now names the line that loads the module, and an `import()` site says the module loads when that call runs, not when the file loads.

  The parse carries these reads as `members`, apart from each request's `bindings`, so test selection reads exactly what it read before. The source index moves to version 12 and the help snapshot to version 3, and each is rebuilt on the first question after the upgrade.
- 47e6664: What the CLI, the MCP tools, the servers and the GitHub action print is shorter. An explanation that repeated on every row now prints once, as a header or on the first line that needs it. The reasoning behind an answer stays in the source and is no longer printed. The source snapshot footer is one line, `Snapshot <time>.`

  A changed file in a language the verdict does not read, such as Rust or Python, now reads as `unread (not a JavaScript or TypeScript module)` instead of as a file that does not parse. It is charged the same way.
- 990ac1a: The agent skills name the commands that ship

  The test-selection skill no longer says there is no command line: it routes
  to `variance select`, `reach`, `index` and `covering`. The CLI skill lists
  every command that reads no config, and covers `covering --hops`, `--cases`,
  the per-file rows, `gained` motion and the `unrecorded` refusal. The workspace
  skill names `variance ask` as the same six questions.
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

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.7.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.6.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

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

### Patch Changes

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

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

First release.
