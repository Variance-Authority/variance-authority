---
name: variance-workspace-api
description: Use when you need what a TypeScript workspace publishes — where a symbol is declared, what it is documented as, who imports it, and the stories, tests and call sites that already use it.
---

# Workspace public API

`variance-authority-help` reads a workspace's manifests and TypeScript source and
answers what it publishes. Every answer describes the checkout as it is now, not
a build and not a generated site.

Use it for the question *what does this repository publish, and how is it already
used here*. What a library on npm is supposed to be is a different question, and
one of its docs is the place to ask it.

## Five names, one thing

They are not interchangeable. Which one you type depends on where you are typing
it.

| Name | What it is | Where it appears |
| --- | --- | --- |
| `@variance-authority/help` | the npm package | `yarn add`, `npx` |
| `variance-authority-help` | the binary that package installs | a shell, an MCP `command` |
| `variance-workspace-api` | this skill | nowhere on a command line |
| `docs_packages` … `docs_gaps` | the six MCP tool names | an MCP client's tool list |
| `workspace-api` | the server key you chose | your own MCP config; rename it freely |

The `docs_` prefix is the wire's namespace. Drop it and you have the shell verb:
`docs_search` is `search`. Nothing else differs — the verbs and the tools are
the same code.

## Preconditions

- **Node 22 or later.** Both the package and the workspace declare `>=22`.
- **The package installed.** `@variance-authority/help` provides the binary
  `variance-authority-help`. It is a devDependency of this workspace, so
  `node_modules/.bin/variance-authority-help` already exists and the binary is on
  the path of any script or shell the package manager set up. If your shell does
  not find it, run it as `npx variance-authority-help …` — see the npx rule
  below — or `yarn add -D @variance-authority/help` where you will ask more than
  once.
- **In this checkout, `dist` must be built.** The workspace link points at
  `packages/help/dist/bin.js`. If it is missing, `yarn build` (or `tsc --build`
  in `packages/help`). An installed copy from the registry ships `dist` and needs
  no build.
- **No run, no config, no revision requirement.** Nothing here reads a run's
  output, and there is no config file. The answer is a function of the source on
  disk right now.
- **Working directory:** the workspace root, or pass `--root <dir>`. See the two
  argument shapes below.

## Ask

Run a verb:

```bash
variance-authority-help search viewport
```

Add `--root <dir>` when you are not standing in the workspace.

### Two argument shapes, and the trap between them

`--root` is for the **verbs**. The other two forms take the root as a **bare
positional**:

```
variance-authority-help <verb> [argument] [--root <dir>]
variance-authority-help [root]                            # serve over MCP on stdio
variance-authority-help write [root] [--out <dir>] [--base <url>]
```

**Any first word that is not one of the six verbs and not `write` is read as a
root directory, and the binary starts an MCP stdio server on it.** There is no
"unknown verb" error at this level. `variance-authority-help serve` does not
serve — it tries to serve a directory named `serve`. That rule is also the whole
explanation of `args: ["."]` in the MCP config below: `.` is the root, and giving
a root with no verb is how you start the server.

Misspellings *inside* a verb are refused, against the tool's own schema:

```
$ variance-authority-help uses digestValue --form x
`uses` takes no `--form`; it takes: name, package, from
```

## Ask about a repository that does not depend on it

```bash
npx @variance-authority/help search session --root ../shadow
```

Ask `npx` for the package — `@variance-authority/help` — never for the command
`variance-authority-help`, which is not a package name and will be reported as
missing from the registry.

That ban is about `npx` only. As a program name — in a shell where the package is
installed, or as an MCP `command` — `variance-authority-help` is correct and is
the only thing that works: those are PATH lookups, not registry lookups.

The target needs no manifest at its root, no `workspaces` field and no build. A
repository that publishes nothing answers entirely out of the exported half:
every name its own files hand out, with the file and the line. That is the usual
shape of a checkout that is not a monorepo — an application with its TypeScript
in one subdirectory — and it is the case where `search` is the only verb worth
asking, because `packages` and `entrypoint` have nothing to report.

## The six verbs, in the order to ask them

Every block below is real output from this checkout, abridged in length only.

### 1. `packages`

Every import specifier the workspace publishes, with how heavily used and how
well documented each one is. It takes no argument and returns the argument every
other verb wants, so start here unless you already hold an exact specifier.

```
$ variance-authority-help packages
@variance-authority/core/format — 102 names, 73 imported elsewhere, 70 documented
@variance-authority/core/compare — 42 names, 14 imported elsewhere, 35 documented
@variance-authority/help — 5 names, 0 imported elsewhere, 4 documented
```

### 2. `entrypoint <package> [subpath]`

The names one specifier opens, most-imported first.

`[subpath]` is the key of the package's `exports` map — `'.'` by default, which
is the main entrypoint. Pass the part *after* the package name, `./` and all, as
`packages` prints it: for `@variance-authority/core/format`, the package is
`@variance-authority/core` and the subpath is `./format`.

```
$ variance-authority-help entrypoint @variance-authority/core ./format
@variance-authority/core/format — 102 names

Viewport [interface] 17 packages, 60 imports — UNDOCUMENTED
Digest [type] 17 packages, 51 imports — Content addressing (Principle 4).
SemanticSnapshot [interface] 14 packages, 50 imports — The normalized semantic snapshot: the verdict's input, and the thing a render hash addresses.
```

### 3. `symbol <name> [--package <package>]`

The line you would write to import it, where it is declared, its signature, and
what the source says above it. The name is matched **exactly**.

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

Where the repository already writes it. Same exact-name matching as `symbol`,
and the same refusal when the name is not published. A published name that
nothing imports is a different answer, not an empty list:

```
`PagesOptions` is published and nothing in this workspace imports it. docs_symbol has its signature and what is written above it.
```

Worked example below.

### 5. `search <substring> [--from <path>] [--to <path>]`

Case-insensitive, over names and over docs, for a name you can only describe. It
answers in two sections: published names first, then the names the repository
exports somewhere without publishing them, each with a file and a line to open.
The second section is much the larger one — most code here was never something to
publish — so a thing you cannot find on the surface is usually in it.

```
$ variance-authority-help search viewport
12 published matches for `viewport`

@variance-authority/core/format · Viewport [interface] 17 packages, 60 imports — UNDOCUMENTED
@variance-authority/storybook · StoryViewport [interface] 0 packages, 0 imports — A per-story viewport override.

4 more names are exported somewhere in the repository without being published:

CORPUS_VIEWPORT — @variance-authority/example-kitchen-sink · examples/kitchen-sink/src/jsdom-profile.ts:21
```

**A published line is `<specifier> · <name> [kind] …`. The two halves go to
different arguments.** `symbol` takes the **name** — `Viewport`, the word after
the `·`. The specifier before it is not an argument to `symbol`; it is the import
line you will eventually write, and its package half is what you would pass to
`--package` if the same name is published from more than one place. So the move
after the line above is `variance-authority-help symbol Viewport`, not `symbol
@variance-authority/core/format`.

An unpublished line carries a `path:line` instead. There is nothing to pass to
`symbol`; open the file.

Nothing back means nothing matched, not that a ranking disagreed, and the answer
says what to ask instead:

```
$ variance-authority-help search zzqqxx
Nothing in this repository is named or documented with `zzqqxx`. `packages` lists every entrypoint; `entrypoint` lists what one opens.
```

Take `packages` first. `entrypoint` needs a specifier you do not have yet, and in
a checkout that publishes nothing neither verb has anything to report — there,
nothing back from `search` is the final answer.

### 6. `gaps`

Names other packages import with nothing written above the declaration. A work
queue, not an answer about one symbol.

```
$ variance-authority-help gaps
111 names cross a package boundary with nothing written above the declaration:

Viewport [interface] packages/core/src/format/environment.ts:73 — used by 17 packages: @variance-authority/example-kitchen-sink, @variance-authority/example-todomvc, @variance-authority/cli, @variance-authority/dom, @variance-authority/observe, and 12 more
```

## Say where you are standing

On a large repository the substring is not enough by itself. A common word is
written into hundreds of names and the text cannot tell them apart, because the
text is the same. What separates them is something you know and the query never
carried — which part of the repository you are in:

```bash
variance-authority-help search order --from src/fulfilment/
```

`--from` answers only from the files that path reaches along the imports, at any
depth. `--to` is the other direction and answers only from the files that reach
it — reach for it when you hold the helper and want its callers. Give both and
you get both areas together, combined rather than intersected: two entry points
of one application usually share no file.

A start point is a path in the checkout, at three widths and no others:
`src/a/File.ts` is that file, `src/a/*` is that folder's own files, `src/a/` is
everything under it. It is read from the root down, segment for whole segment,
case included — no stemming, no dropped extension, no matching tail. A path the
checkout does not hold is refused by name, so you are never quietly answered
about the whole repository.

This removes names rather than ranking them down. An empty answer under a start
point is a fact about that area; ask again without `--from` and `--to` when you
want the whole workspace. The answer says how many files it looked in, so you
can place the count it gives you.

## Two different questions about one name

`symbol` answers what a name is *supposed* to be: the signature, and the block
comment somebody wrote above it. `uses` answers how it is *actually* written
here, off the imports, which is the answer a stale doc comment cannot spoil. Ask
the second whenever you are about to write a call and the signature alone leaves
a choice open.

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

Pass `--from` — the file you are editing — and the sites come back ordered by how
many leading path segments they share with it, nearest first. That is proximity
on the filesystem, and it only orders: every site of the name still comes back.

`--from` on `search` is the other kind of argument. It is a start point, the
import graph is walked, and names outside the closure are removed. The flag is
spelled the same because the value you pass is the same — the file you are
working in — but one narrows and one sorts.

Neither is a distance. How many hops separate two modules belongs to
`variance-test-selection`.

The answer separates the files written to *show* the name — stories and tests —
from the source that depends on it. Read the stories first: a story is somebody's
worked example of the same call you are about to write. A section with no members
is omitted rather than shown empty, as `Stories` is above.

Sites arrive as `path:line`, not as text. Open them. What you read then is the
file as it is, rather than a copy taken when the reading was.

## Read the answer literally

- A name with no block comment is reported as having none — `UNDOCUMENTED` in the
  one-line listings. Where the nearest `README.md` above the declaration writes
  the name as a whole word, the passage comes back labelled with its file and
  line. That is prose written about a package, not a description of the signature
  above it, and the name still counts as a gap. Do not repeat it as if it were
  documentation.
- A consumer is a workspace package whose source imports the name. It is not a
  claim that anything ran.
- A site is an import, not a call. Where the name is used inside that file is a
  question for a language server.
- Nothing here reads `dist`. A `types` target under an output directory is mapped
  back to the source it was compiled from.
- `search` caps its published section at 40 and its unpublished section at 25,
  and says so in the answer when it cut. A list with no such line is the whole
  list.

## The cache cannot change an answer

The index is kept per checkout under `~/.cache/variance-authority/` — or under
`$XDG_CACHE_HOME` when that is set — outside the tree being read, so it survives
a throwaway install and nothing is written into somebody else's repository.

It is **content-keyed**, not time-keyed. Git names each file's content without
opening it and the digest names what parsing that content produced, so an edited
file misses and is re-parsed on the next question. There is nothing to expire and
no flag to force a fresh read: a missing, incompatible, incomplete or corrupt
index behaves as an empty one, which makes the scan slower and cannot change the
resulting answer. That is what lets this file promise the checkout as it is now.

If you want the cold-start timing anyway, delete the directory — it is rebuilt on
the next question. A worktree writes to its own layer beneath the primary
checkout's, so deleting one checkout's cache does not touch another's.

## Over MCP instead

A client that holds a connection open all session can list the same six as
tools — `docs_packages`, `docs_entrypoint`, `docs_symbol`, `docs_uses`,
`docs_search`, `docs_gaps` — taking the same arguments, under their schema names
(`package`, `subpath`, `name`, `query`, `from`, `to`) rather than as positionals.

```json
{
  "mcpServers": {
    "workspace-api": {
      "command": "variance-authority-help",
      "args": ["."]
    }
  }
}
```

`command` is the installed binary, found on PATH — not an `npx` invocation, so
the rule above does not apply to it. `args` is a bare root and no verb, which is
exactly the form that starts a stdio server; `.` means the directory the client
launches the process in, so use an absolute path if that is not the workspace.

The server re-reads the workspace on every request, so an edit made in one turn
is visible in the next. It reads the manifests once at startup, so a path that is
not a workspace fails immediately rather than on whichever question you ask
first.

The integration reference is
`https://variance-authority.dev/reference/packages/help`; the routing across the
other entrances is at `https://variance-authority.dev/agents/questions`.
