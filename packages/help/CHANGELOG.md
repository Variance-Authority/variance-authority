# @variance-authority/help

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
