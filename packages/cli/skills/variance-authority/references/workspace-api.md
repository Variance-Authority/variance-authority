# What a workspace publishes, and where a name is used

Nine questions read a workspace's manifests, source and test recording. Seven
answer what it publishes, and each of their answers names the UTC time of the
workspace generation it used. `orient` with no files prints the code map, the
repository's packages in areas; with files you already have, it says what the
code around them is. `slowest-tests` reads the latest recorded
test run and lists the files and cases it spent longest in.
They describe source, not a build or a generated site, and they need no run and
no config.

Use them for *what does this repository publish, and how is it already used
here*. What a library on npm is supposed to be is a different question, and its
own documentation is the place to ask it.

## Two binaries, one implementation

`variance ask <verb>` and `variance-authority-help <verb>` run the same code and
give the same answers. Use whichever the workspace already has.

```bash
variance ask search --query viewport
variance-authority-help search viewport
variance-authority-help search viewport --from packages/app/ --just-answer
```

On `variance ask` every argument is a flag (`--query`, `--name`, `--package`,
`--subpath`, `--from`, `--to`), and `variance ask` with no question lists them.
On `variance-authority-help` the first argument is positional, as the sections
below show.

The names are not interchangeable; which one you type depends on where you type
it:

| Name | What it is | Where it appears |
| --- | --- | --- |
| `@variance-authority/help` | the npm package | a manifest, a package runner |
| `variance-authority-help` | the binary that package installs | a shell, an MCP `command` |
| `docs_packages` … `docs_gaps` | the nine MCP tool names | an MCP client's tool list |
| `workspace-api` | the server key you chose | your own MCP config; rename it freely |

The `docs_` prefix is the MCP namespace. Drop it, turn `_` into `-`, and you
have the verb: `docs_search` is `search`, `docs_slowest_tests` is `slowest-tests`.

## Before the first question

- **Node 22 or newer.** `@variance-authority/help` declares `>=22`.
- **One of the two binaries.** `@variance-authority/cli` provides `variance ask`;
  `@variance-authority/help` provides `variance-authority-help`. In a checkout of
  the repository that develops them, build first; an installed copy ships built.
- **No run, no config, no revision requirement.** Ordinary questions reuse a
  published generation for up to one hour. `--just-answer` uses the last
  generation without inspecting the checkout, and refuses when none exists.
  `search` always reads that way, with or without the flag, and never scans.
- **Working directory:** the workspace root, or pass `--root <dir>` to a verb.

Use `--just-answer` when CI, an editor or a watcher owns generation, or when an
answer must include no freshness work. The timestamp is part of the answer;
decide from it whether the producer needs to publish again.

## Two argument shapes, and the trap between them

`--root` is for the **verbs**. The other two forms take the root as a **bare
positional**:

```
variance-authority-help <verb> [argument] [--root <dir>] [--just-answer]
variance-authority-help [root] [--just-answer]            # serve over MCP on stdio
variance-authority-help write [root] [--out <dir>] [--base <url>]
```

**Any first word that is not one of the nine verbs and not `write` is read as a
root directory, and the binary starts an MCP stdio server on it.** There is no
"unknown verb" error at this level: `variance-authority-help serve` tries to
serve a directory named `serve`. That rule is also why the MCP config in
[MCP](mcp.md) passes `args: ["."]`.

A misspelling *inside* a verb is refused against the tool's own schema:

```
$ variance-authority-help uses digestValue --form x
`uses` takes no `--form`; it takes: name, package, from
```

## Ask about a repository that does not depend on it

Point the verb at the other checkout with `--root`. When the binary is not
installed, ask the package runner for the package `@variance-authority/help`,
never for the command `variance-authority-help`: that is not a package name, and
the registry reports it missing. As a program name, in a shell where the package
is installed or as an MCP `command`, `variance-authority-help` is correct and is
the only spelling that works, because those are `PATH` lookups, not registry
lookups.

The target needs no manifest at its root, no `workspaces` field and no build. A
repository that publishes nothing answers entirely from the exported half: every
name its own files export, with the file and the line. That is the usual shape
of a checkout that is not a monorepo, such as an application with its source in
one subdirectory, and there `search` is the only verb worth asking, because
`packages` and `entrypoint` have nothing to report.

## Names, then relations

`search` turns the words you have into candidate names. When the editor, ticket
or stack trace already gives you a path, pass it on that first search as a start
point (`--from`, `--to`; see `SKILL.md`). Then ask `symbol` for the chosen
name's contract, and `uses` for its exact import sites and worked examples.

This is a module graph, not a call graph. Never turn an import site into a claim
that one function calls another; open the file or ask a language server.

## The nine verbs, in the order to ask them

Every block below is real output from the repository that develops this tool,
shortened only.

### 1. `packages`

Every import specifier the workspace publishes, with how much each is used and
how well documented. It takes no argument and returns the argument every other
verb wants, so start here unless you already have an exact specifier.

A published specifier comes from a `package.json` `exports` field, so this verb
and `entrypoint` answer for the JavaScript half of a mixed repository. The other
four read the source and answer for every language: ask `search` or `symbol` for
a Python, Rust, Java, Kotlin or Swift name.

```
$ variance-authority-help packages
@variance-authority/core/format — 102 names, 73 imported elsewhere, 70 documented
@variance-authority/core/compare — 42 names, 14 imported elsewhere, 35 documented
@variance-authority/help — 5 names, 0 imported elsewhere, 4 documented
```

### 2. `entrypoint <package> [subpath]`

The names one specifier opens, most imported first. Pass the specifier exactly
as `packages` prints it (`@variance-authority/core/format`), or the package name
and the subpath apart, where `[subpath]` is the key of the package's `exports`
map, `'.'` by default: `@variance-authority/core ./format` opens the same
specifier.

```
$ variance-authority-help entrypoint @variance-authority/core ./format
@variance-authority/core/format — 102 names

Viewport [interface] 17 packages, 60 imports — UNDOCUMENTED
Digest [type] 17 packages, 51 imports — Content addressing (Principle 4).
SemanticSnapshot [interface] 14 packages, 50 imports — The normalized semantic snapshot: the verdict's input, and the thing a render hash addresses.
```

### 3. `symbol <name> [--package <package>]`

The line you would write to import it, where it is declared, its signature, and
the comment above it. The name is matched **exactly**.

```
$ variance-authority-help symbol sharedSegments
sharedSegments [function]
import { sharedSegments } from '@variance-authority/help/tools';
declared at packages/help/src/tools/uses.ts:36
used by nothing outside its own package

function sharedSegments(left: string, right: string): number

How many leading path segments two files share.
```

`--package` is the **package name only**, never a specifier with a subpath, and
it only narrows: it answers from that package instead of from every specifier
that publishes the name.

A miss is a refusal on stderr with exit code 1:

```
$ variance-authority-help symbol NotAThing
`NotAThing` is not published by this workspace; ask `search` for a name like it
```

### 4. `uses <name> [--from <file>] [--package <package>]`

Where the repository already writes it. Same exact matching as `symbol`, and the
same refusal when the name is not published. A published name that nothing
imports is a different answer, not an empty list:

```
`PagesOptions` is published and nothing in this workspace imports it. docs_symbol has its signature and what is written above it.
```

`symbol` answers what a name is *supposed* to be: the signature and the comment
somebody wrote above it. `uses` answers how it is *actually* written here, from
the imports, which a stale doc comment cannot spoil. Ask it whenever you are
about to write a call and the signature alone leaves a choice open. A name read
off `import()` or `import * as` is listed with the line that loads the module,
and an `import()` loads it only when that call runs.

```
$ variance-authority-help uses digestValue --from packages/cli/src/run.ts
`digestValue` is imported in 16 places.
Nearest to packages/cli/src/run.ts first.

Tests:

packages/mcp/src/presentation.test.ts:2 — @variance-authority/mcp
packages/report/src/file.test.ts:5 — @variance-authority/report

Source:

packages/dom/src/attributed.ts:1 — @variance-authority/dom
packages/playwright/src/renderer.ts:2 — @variance-authority/playwright
```

**`uses --from` sorts; `search --from` narrows.** On `uses`, `--from` is the file
you are editing, and the sites come back ordered by how many leading path
segments they share with it. That is filesystem proximity, and every site still
comes back. On `search`, `--from` is a start point: the import graph is walked
and names outside it are removed. The flag has one spelling because the value is
the same file. Neither is a distance; hop counts belong to [test
selection](test-selection.md).

The answer separates the files written to *show* the name, stories and tests,
from the source that depends on it. Read the stories first: a story is somebody's
worked example of the call you are about to write. A section with no members is
left out rather than shown empty, as `Stories` is above.

Sites arrive as `path:line`, not as text. Open them: what you read then is the
file as it is now.

### 5. `search <words> [--from <path>] [--to <path>]`

Case-insensitive, over names and over docs, for a name you can only describe.
It answers in two sections: published names first, then the names the
repository exports somewhere without publishing them, each with a file and a
line. The second section is usually much larger, since most code was never
meant to be published, so a thing you cannot find on the surface is usually
there.

```
$ variance-authority-help search viewport
12 published matches for `viewport`

@variance-authority/core/format · Viewport [interface] 17 packages, 60 imports — UNDOCUMENTED
@variance-authority/storybook · StoryViewport [interface] 0 packages, 0 imports — A per-story viewport override.

4 more names are exported somewhere in the repository without being published:

CORPUS_VIEWPORT — @variance-authority/example-kitchen-sink · examples/kitchen-sink/src/jsdom-profile.ts:21
```

`--format json` on `variance ask search` returns the same answer as data:
specifier, file, line and counts.

**A published line is `<specifier> · <name> [kind] …`, and the two halves go to
different arguments.** `symbol` takes the **name**, the word after the `·`. The
specifier before it is the import line you will write, and its package half is
what you pass to `--package` when the same name is published from more than one
place. So the next question after the line above is `symbol Viewport`, not
`symbol @variance-authority/core/format`. An unpublished line has a `path:line`
instead: there is nothing to pass to `symbol`, so open the file.

Nothing back means nothing matched, not that a ranking disagreed, and the answer
says what to ask instead:

```
$ variance-authority-help search zzqqxx
Nothing in this repository is named or documented with `zzqqxx`. `packages` lists every entrypoint; `entrypoint` lists what one opens.
```

In a checkout that publishes nothing, `packages` and `entrypoint` have nothing
to report, so nothing back from `search` is the final answer there.

A third section appears only when your words match a name that does not contain
them: a mistyped word, or two words written about a name but not next to each
other.

```
$ variance-authority-help search "numbers order"
Nothing in this repository is named or documented with `numbers order`.

1 more name matches loosely — your words apart, or within a character of the ones written. Nothing above was reordered by this.

alpha · Span [type] 0 packages, 0 imports — Two numbers, in order.
```

Read it as a suggestion, not an answer. It never changes the sections above it,
never repeats a name they gave you, and obeys `--from` and `--to` as they do. It
does not find a word the repository never writes; for that, expand the query as
`SKILL.md` describes under *Matching is lexical*. Once you have one real hit,
`uses` shows where the repository writes it and `entrypoint` shows everything
published beside it.

**A start point removes names, it does not rank them down.** `search --from`
answers with published names those files import, ordered by the number of
importing files in that area, and reports those files by import distance from
the start point beside the workspace-wide count. `--to` does the same for files
that import the path; use it when you have the helper and want its dependents.
Two entry points of one application usually share no file, which is why giving
both combines them. Internal exports have no import-site count, so they are
admitted by the declaring file. A path is read from the root down, segment by
whole segment, case included, with no stemming, no dropped extension and no
matching tail. A path the checkout does not have is refused by name, so you are
never answered about the whole repository without knowing it. An empty answer
under a start point is a fact about that area; ask again without it for the
whole workspace. The answer says how many files it looked in.

### 6. `grep <pattern> --from <path> | --to <path>`

ripgrep, run on the files a start point reaches. Use it when there is no name
to ask for: a string literal, an error message, a comment. The closure is the
one `search --from` walks, and the pattern goes to `rg` unchanged, so it is a
regular expression and your ripgrep config applies. `rg` must be on `PATH`.

```
$ variance ask grep --query 'OperatorError\(' --from packages/cli/src/bin.ts --limit 3
In 112 file(s) reachable from `packages/cli/src/bin.ts` along the imports, at any depth — 1 named by the path itself.

130 matching lines in 41 files, nearest first.

0 imports away:
packages/cli/src/bin.ts:63:    if (isOperatorError(error)) {

1 import away:
packages/cli/src/dispatch.ts:327:        throw new OperatorError(
packages/cli/src/dispatch.ts:348:        throw new OperatorError(

127 more not shown; a higher `limit` shows them.
```

Lines are grouped by import distance from the start point, then sorted by path
and line, so the same question gives the same answer. Each line is
`path:line:text`, as `rg` prints it. 200 lines are shown unless `--limit` says
otherwise, and the rest are counted.

A start point is required. Without one, the question is `rg <pattern>`, and the
refusal says so. A closure of thousands of files is passed to `rg` in several
calls, each under the operating system's command-line limit.

### 7. `orient [--area <id>]` and `orient --files <path>[,...]`

Ask it with no files when you hold nothing yet. It prints the code map that
`variance index` builds beside the source index. The top page puts every package
the manifests name into a few areas, apart from a manifest under a directory the
source index skips, such as `node_modules` or `dist`. A package joins the
packages that sit in the same directory, share words in their names, and import
each other. An area of more than twelve packages is split again, into at most
twelve areas of at least three packages, none starting larger than a third of
it. A package no area takes is listed after the rows, and `--area <id>` prints
that area's page, down to a leaf that lists its packages. Each row gives the
package and source-file counts, the dependency layers it spans (layer 0 imports
no other package), its front (the packages the rest of the repository imports
most from it, with their share), and the areas it imports from, with their
share of its imports.

```
$ variance ask orient
# variance-authority: 59 packages in 8 dependency layers (0 takes nothing), 1.1k source files, 8 areas
1 example · 16 pkg, 153 files · layers 1–3 (median 3) · front: playwright 33%, eyes 24% (+3) · uses 2 100%
2 around core, sense · 11 pkg, 528 files · layers 0–6 (median 2) · front: core 73% (+4) · uses 5 68%, 6 11%
…
$ variance ask orient --area 1
# 1 example: 16 packages in dependency layers 1–3 of 8, 153 source files, 3 areas
1.1 example case · 6 pkg, 78 files · layers 2–3 (median 3) · front: playwright 100% · uses 2 71%, 1.2 18%
…
```

With no map beside the index, the answer says so and names `variance index`.
When the index has changed since the map was built, the page says that too.
`--area` and `--files` are not asked together.


Ask it with `--files` when you already have files, from a stack trace, a ticket, your editor,
or `search`, `symbol` and `grep`, which find them. It finds nothing itself and
reads no file's text. Each file is answered in the order you gave it: the
package it is in, or that the source index does not hold it. For each of those
packages it prints what the package imports from other packages and what other
packages import from it. A use is one file importing one name from another
package. A package's share is of the uses on that side. A name's share is of all
the use the package that exports it gets from outside, so it says what part of
that package's use the name is. It also names external packages requested along
local imports from those files, with each request's source line. Manifest
declarations are context beside that evidence; declarations without import
evidence along the path are listed separately. An unread path is named rather
than reported as using nothing. Then it prints how many recorded test cases ran
each file, and for a test file the cases it declares. Last come the narrower
questions, as commands. Run it from the checkout you are asking about.

```
$ variance ask orient --files packages/cli/src/parse.ts,packages/cli/src/commands/carry.ts
2 files asked about:
  packages/cli/src/parse.ts           @variance-authority/cli
  packages/cli/src/commands/carry.ts  @variance-authority/cli

Packages, from the source index at …/source-index.bin (2151 files indexed).
A use is one file importing one name from another package. A package's share is of the uses on that side; a name's share is of every use the package exporting it gets from outside.

@variance-authority/cli  packages/cli
  Takes from, 17 packages, 728 uses:
     30%  @variance-authority/core     RenderIdentity 1%, SourceIndex 1%, SemanticSnapshot 1%, Relations 1%, 79 more names
     29%  @variance-authority/sense    testCoverageFile 4%, the whole module 3%, ExecutionIndex 3%, ExecutionNarrowing 2%, 91 more names
     15%  @variance-authority/report   ObservationRecord 3%, RunReport 3%, FindingRecord 1%, Change 1%, 70 more names
      7%  @variance-authority/raster   RasterStore 5%, Renderer 5%, BaselineKey 4%, Found 3%, 9 more names
      5%  @variance-authority/history  HistoryStore 5%, Instability 2%, RunRecord 2%, Observation 2%, 14 more names
     15%  12 more packages
  Used by, 2 packages, 2 uses:
     50%  variance-authority  parseConfig 50%
     50%  site                default 50%

Recorded cases, suite unit, from …/suites/unit/coverage.bin.cases.bin:
  packages/cli/src/parse.ts           101 cases ran it, and it also ran while its module evaluated*:
      packages/cli/src/accept-without-a-run.test.ts > accept with no run report on disk > names the path it looked for and the configuration key that decided it
      packages/cli/src/accept-without-a-run.test.ts > accept with no run report on disk > refuses as an operator error rather than crashing
      packages/cli/src/accept-without-a-run.test.ts > accept with no run report on disk > says a run must have happened, and names the dead end a cold reader hits
      98 more cases.
  packages/cli/src/commands/carry.ts  12 cases ran it, and it also ran while its module evaluated*:
      packages/cli/src/commands/carry.test.ts > a recording > is not saved from a pull request, and the plan says so
      packages/cli/src/commands/carry.test.ts > a recording > is not saved when no mainline is known, naming the answers that were missing
      packages/cli/src/commands/carry.test.ts > a recording > restores from the base on its line, then the newest there, then another mainline
      9 more cases.
  * The recording names no case for what runs while a module evaluates. The cases whose files import the module ran it, and `variance covering --file` names them.

Narrower questions:
  variance ask uses --name parseConfig --package @variance-authority/cli
  variance ask symbol --name parseConfig --package @variance-authority/cli
  variance ask symbol --name RenderIdentity --package @variance-authority/core
  variance covering --file packages/cli/src/parse.ts --suite unit
```

The packages come from the source index `variance index` publishes, and the
cases from the latest recording of each suite. When either one was never
published, its part is one line that names where it looked. A side with no uses
says why: no package uses it, none of the package's files is in the index, or
the imported names of its files were not read.

A file with no row in the recording is *not recorded*, which says nothing about
whether a test runs it. *No case ran it* is only said of a file the recording
has a row for and no region of which ran. Code that runs while its module
evaluates is recorded under no case, so a file marked `*` ran under more cases
than the count says. `variance covering --file` names them, from the test files
that import it. A test file is answered with the cases it declares. The
`--from` question starts at the first shown file the index has a record for.

### 8. `slowest-tests [--from <path>[,...]] [--to <path>[,...]] [--limit <n>]`

The test files, then the test cases, the latest recorded run spent longest in,
slowest first, with the duration the test runner reported for each. A case row
names its file and its declaration path. Nothing here times a test: a file or
case whose runner reported no duration, or one a recording older than durations
holds, is counted apart and never ranked as instant. It reads the recording
`yarn test` writes for `test:since`, suite by suite, and says where it looked
when there is none.

*Slowest* is usually a question about somewhere. `--from` keeps the tests
declared under those paths. `--to` keeps the tests the recording says entered
code in those files or directories: the same reading `variance covering` makes,
never an import walk. The two combine, and every count is within the scope. The
first line names the scope. When the scope matched nothing, the answer says
which half matched nothing. A `--to` path the recording has no row for is named
as unrecorded, which says nothing about whether a test enters it. A path in
neither the recording nor the checkout is refused, with the nearest recorded
path suggested.

```
$ variance ask slowest-tests --limit 2
Slowest recorded test files, suite unit, as their runner reported them, from <cache>/test-selection/<key>/suites/unit/coverage.bin:
  79.7 s  packages/route-collector/src/stabilization.chromium.test.ts
  33.9 s  packages/playwright/src/renderer.test.ts
2 of 607 timed file(s) shown; 10 recorded file(s) have no duration.

Slowest recorded test cases, suite unit, as their runner reported them, from <cache>/test-selection/<key>/suites/unit/coverage.bin.cases.bin:
  52.7 s  packages/route-collector/src/stabilization.chromium.test.ts  an animation in flight, observed twice > costs what it is worth, per subject, and says so
  30.2 s  packages/playwright/src/renderer.test.ts  createPlaywrightRenderer — concurrency > returns a page to the pool when a render throws, rather than deadlocking
2 of 5690 timed case(s) shown.

$ variance ask slowest-tests --limit 1 --to packages/sense/src/recorded-scope.ts
Slowest recorded test files, suite unit, that entered packages/sense/src/recorded-scope.ts, as their runner reported them, from <cache>/test-selection/<key>/suites/unit/coverage.bin:
  9.8 s  packages/cli/src/commands/share.test.ts
1 of 40 timed file(s) shown.

Slowest recorded test cases, suite unit, that entered packages/sense/src/recorded-scope.ts, as their runner reported them, from <cache>/test-selection/<key>/suites/unit/coverage.bin.cases.bin:
  767 ms  packages/sense/src/test-selection/durations.integration.test.ts  the duration a recording keeps > is scoped by the readers `variance covering` asks, and the two records agree on who entered a module
1 of 11 timed case(s) shown.
```

### 9. `gaps`

Names other packages import with nothing written above the declaration. A work
queue, not an answer about one name.

```
$ variance-authority-help gaps
111 names cross a package boundary with nothing written above the declaration:

Viewport [interface] packages/core/src/format/environment.ts:73 — used by 17 packages: @variance-authority/example-kitchen-sink, @variance-authority/example-todomvc, @variance-authority/cli, @variance-authority/dom, @variance-authority/observe, and 12 more
```

## Read the answer literally

- A name with no comment above it is reported as having none: `UNDOCUMENTED` in
  the one-line listings. Where the nearest `README.md` above the declaration
  writes the name as a whole word, that passage comes back labelled with its
  file and line. It is prose about a package, not a description of the
  signature, and the name still counts as a gap. Do not repeat it as if it were
  documentation.
- A consumer is a workspace package whose source imports the name. It is not a
  claim that anything ran.
- A site is an import, not a call. Where the name is used inside that file is a
  question for a language server.
- Nothing here reads `dist`. A `types` target under an output directory is
  mapped back to the source it was compiled from.
- `search` caps its published section at 40, its unpublished section at 25 and
  its loose section at 15, and says so when it cut. A list with no such line is
  the whole list.

## Read freshness literally

The index is kept per checkout in the cache `SKILL.md` describes, outside the
tree being read unless that repository's `cacheRoot` names a place inside it,
so it survives a throwaway install and nothing is written into somebody else's
repository.

The workspace generation has a production time. Ordinary mode reuses it for one
hour and refreshes it after that. `--just-answer` runs no Git status, scan or
refresh, whatever its age. Every answer prints that time, so stale data is
visible rather than presented as current.

A missing, incompatible, incomplete or corrupt source index behaves as an empty
cache and makes production slower; it cannot change the generation produced. A
missing workspace generation under `--just-answer` is a refusal, not an implicit
cold scan.
