# What a workspace publishes, and where a name is used

Six questions read a workspace's manifests and source and answer what it
publishes. Every answer names the UTC time of the workspace generation it used.
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
| `docs_packages` … `docs_gaps` | the six MCP tool names | an MCP client's tool list |
| `workspace-api` | the server key you chose | your own MCP config; rename it freely |

The `docs_` prefix is the MCP namespace. Drop it and you have the verb:
`docs_search` is `search`.

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

**Any first word that is not one of the six verbs and not `write` is read as a
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

## The six verbs, in the order to ask them

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
about to write a call and the signature alone leaves a choice open.

```
$ variance-authority-help uses digestValue --from packages/cli/src/run.ts
`digestValue` is imported in 16 places.
Nearest first, by how much of the path each shares with packages/cli/src/run.ts.

Tests — written to pin what it does:

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

### 6. `gaps`

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
