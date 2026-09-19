<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/help

> Find the public name, signature, documentation, consumers and call sites of an exported TypeScript workspace symbol, over MCP.

Part of [Variance Authority](https://variance-authority.dev), a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

## What this is for

Install this if you maintain a TypeScript repository and want a person or a
coding agent to be able to ask what a name in it is, where it is declared, who
imports it, and where the repository already writes it.

It reads TypeScript source off disk and answers six questions about exported
names. Nothing has to be built first, no documentation is generated ahead of
time, and the repository does not have to be one of yours: point it at any
checkout with `--root`.

It answers two different questions about a name. What the name is supposed to be
comes off the declaration — its signature and the block comment above it. How
the name is actually written here comes off the call sites, and that is the
answer a stale doc comment cannot spoil.

This package has nothing to do with taking or comparing screenshots. If you came
here looking for the visual regression runner, that is
[`@variance-authority/cli`](https://variance-authority.dev/reference/packages/cli);
nothing on this page is a step in that workflow.

## Requirements

Node 22 or newer. The package is ESM-only (`"type": "module"`), so a CommonJS
project reaches it through `import()`. There are no peer dependencies and no
configuration file. It works on a checkout that is not a git repository, is not
a workspace, and has no `package.json` at all — with no manifest there is
nothing published, so every answer comes from what the source exports.

## Ask one question

The binary is `variance-authority-help`. Installed as a devDependency it is on
the path under `npx`:

```bash
npm install --save-dev @variance-authority/help
npx variance-authority-help search viewport
```

Six verbs, each taking the same arguments as the tool of the same name below:
`packages`, `entrypoint`, `symbol`, `uses`, `search`, `gaps`. An entrypoint is
one import specifier a package's `exports` map opens — `@scope/pkg` and
`@scope/pkg/deep` are two of them. Add `--root <dir>` when you are not standing
in the repository you are asking about.

The same six are questions on `variance ask` wherever
[`@variance-authority/cli`](https://variance-authority.dev/reference/packages/cli)
is installed — `npx variance ask search --query viewport` — so a workspace that
runs the visual suite needs nothing from this package to ask them. This package
is for the workspace that does not.

### What you get

Text, on stdout. `search` answers in two sections — the names a manifest
publishes, ranked by how many packages import them, then the names the source
exports without publishing — and in a third when your words reach a name they do
not contain. Run against this repository, abridged to the first few lines of
each section:

```
12 published matches for `viewport`

@variance-authority/core/format · Viewport [interface] 17 packages, 60 imports — UNDOCUMENTED
@variance-authority/core/format · documentDigest [function] 12 packages, 27 imports — Content address of a document: *what is to be painted*.
@variance-authority/dom · conditionsFor [function] 1 packages, 1 imports — The condition environment a capture of this document would be flattened against.
@variance-authority/storybook · harnessPage [function] 1 packages, 1 imports — Drive the page a harness already owns.
@variance-authority/cli · ConfigError [class] 0 packages, 0 imports — A refusal that names the field.

4 more names are exported somewhere in the repository without being published:

CORPUS_VIEWPORT — @variance-authority/example-kitchen-sink · examples/kitchen-sink/src/jsdom-profile.ts:21
VIEWPORT — @variance-authority/cli · packages/cli/src/commands/run-fixture.ts:48
parseViewport — @variance-authority/cli · packages/cli/src/config-sections.ts:241
```

A published name is API and carries the specifier you would import it from. An
exported name carries a file and a line, because nothing else was read for it.

`symbol` answers with the one thing you asked about, in full.
Run `npx variance-authority-help symbol Viewport`:

```
Viewport [interface]
import { Viewport } from '@variance-authority/core/format';
declared at packages/core/src/format/environment.ts:73
used by 17 packages: @variance-authority/example-kitchen-sink, @variance-authority/example-todomvc, @variance-authority/cli, @variance-authority/dom, and 13 more — 60 imports

interface Viewport

Nothing is written above this declaration.

docs_uses names the 60 places this is imported, nearest to a file you name first.
```

## The six questions

Ranking is one number: how many packages in the repository import the name. A
frequently imported name leads; a name nothing outside its own package reaches
stays available without taking space from the first answer.

| verb / tool | takes | answers |
|---|---|---|
| `packages` / `docs_packages` | nothing | every import specifier the repository publishes, with how heavily used and how well documented each is |
| `entrypoint` / `docs_entrypoint` | a package name, optionally a subpath | the names that one specifier opens, most-imported first |
| `symbol` / `docs_symbol` | a name | the import line, the place, the signature, the doc — or the README passage that names it — and who imports it |
| `uses` / `docs_uses` | a name, optionally the file you are in | every place that imports it, stories and tests listed apart, nearest first |
| `search` / `docs_search` | a string, optionally a path to answer from | published names whose name or doc contains it, then the names exported without being published, then the ones only a looser reading reaches |
| `gaps` / `docs_gaps` | nothing | names other packages import that say nothing about themselves |

`packages` takes no argument and returns the import specifiers every other
question takes as input, so it is the natural first call.

Every request re-reads the repository, so an answer reflects the files on disk
now rather than the ones read at startup. The read is manifests and module
records, not a compilation, and the module records come from the source index
[`@variance-authority/sense`](https://variance-authority.dev/reference/packages/sense)
keeps: git names each file's content without opening it, the digest names what
parsing that content produced, and a file that did not change is never opened
twice. A repository where nothing moved answers out of that index; one where ten
files moved parses ten files.

### Say where you are standing

On a few thousand names a substring is enough. On a large repository it is not,
and no ranking rescues it: `order` really is written into four hundred names,
you wanted the nine in one service, and the text cannot tell those apart because
the text is the same.

What separates them is something you know and the query never carried — which
part of the repository you are in. So `docs_search` takes it as a path:

```
docs_search  query: order  from: src/fulfilment/
```

`from` follows the imports at any depth, then answers with published names those
files actually import. Results are ordered by the number of importing files in
that area, and each line reports those files by import distance from the start
point beside the workspace-wide count. `to` walks the other direction and does
the same for files that reach the path — the one to reach for when you have the
helper and want its callers. Give both and you get both areas, unioned: two entry
points of one application share almost no file, so intersecting them would
answer nothing about a question that named two places. Internal exports have no
import-site count, so they are admitted by the declaring file instead.

A path is a path, at three widths and no others — `src/a/File.ts` is that file,
`src/a/*` is that folder's own files, `src/a/` is everything under it. A path
the checkout does not hold is refused by name. You are never quietly answered
about the whole repository under a heading you would read as *your area*.

This removes names rather than ranking them down, which is the point: an empty
answer is then a fact about the area, and the answer says how many files it
looked in so you can place the count it gives you.

### When the word you typed is not the word that was written

A substring answers the string you gave it and nothing else. Two questions it
cannot answer at all: a word typed two characters wrong, and two words that are
both written about a name but not written beside each other — `read span`
appears in no text anywhere, and the declaration you wanted says both.

Those get a third section, and only those. Ask for `numbers order` in this
repository's own fixture and the substring finds nothing, which is said first:

```
Nothing in this repository is named or documented with `numbers order`.

1 more name matches loosely — your words apart, or within a character of the
ones written. Nothing above was reordered by this.

alpha · Span [type] 0 packages, 0 imports — Two numbers, in order.
```

It may only add. Nothing the two sections above answered is scored, reordered,
promoted, demoted or removed by it, a name they already returned can never
appear in it, and when it has nothing to add it prints nothing — so an answer to
a word that was written stays exactly as short as it was. It obeys `from` and
`to` as they are: the looser reading runs over the files the area allows, so it
can reach a name you did not type and never a file you ruled out.

Inside it the order is the order above — by how many packages import the name,
then by name. Membership is the only decision the looser reading makes, because
you can check why a name is on a list and can only trust where it sits on one.

### Where the declaration says nothing

A name with no block comment above it is reported as undocumented. Before
reporting it, the nearest `README.md` above the declaring file is searched, and
where that prose names the symbol as a whole word the passage comes back
labelled with the file and line it was read from. The passage is never presented
as the symbol's documentation, and it never removes the name from `gaps`.

`gaps` turns the same ranking into a work queue.
Run `npx variance-authority-help gaps`, abridged to the first three lines:

```
111 names cross a package boundary with nothing written above the declaration:

Viewport [interface] packages/core/src/format/environment.ts:73 — used by 17 packages: @variance-authority/example-kitchen-sink, @variance-authority/example-todomvc, @variance-authority/cli, @variance-authority/dom, @variance-authority/observe, and 12 more
collect [function] packages/dom/src/collect.ts:197 — used by 14 packages: @variance-authority/case-incumbent, @variance-authority/example-agent-claim, @variance-authority/example-dynamic-route-flake, @variance-authority/example-kitchen-sink, @variance-authority/example-layout-impact, and 9 more
normalize [function] packages/core/src/rules/normalize/index.ts:59 — used by 14 packages: @variance-authority/case-incumbent, @variance-authority/example-agent-claim, @variance-authority/example-dynamic-route-flake, @variance-authority/example-kitchen-sink, @variance-authority/example-layout-impact, and 9 more
```

### Where the repository already writes it

`uses` answers with the file and line of every import, and it separates the
files written to *show* a name in use — stories and tests — from the ones that
depend on it. Both are pointed at rather than quoted: the path and the line are
what an editor opens.

Pass `--from` — the file you are working in — and the sites come back ordered by
how many leading path segments they share with it:

```bash
npx variance-authority-help uses collect --from packages/cli/src/index.ts
```

```
`collect` is imported in 24 places.
Nearest first, by how much of the path each shares with packages/cli/src/index.ts.

Tests — written to pin what it does:

examples/todomvc/src/changeset.test.tsx:13 — @variance-authority/example-todomvc
examples/todomvc/src/closure.test.tsx:6 — @variance-authority/example-todomvc

Source:

packages/playwright-test/src/page-agent.ts:1 — @variance-authority/playwright-test
packages/presentation/src/browser-agent.ts:3 — @variance-authority/presentation
```

That ordering is a claim about the filesystem, not about the import graph.
Import distance is owned by
[`@variance-authority/sense`](https://variance-authority.dev/reference/packages/sense),
and it needs an index this server does not keep.

## On a repository you are passing through

```bash
npx @variance-authority/help search session --root ../shadow
```

Install it where you will ask more than once, and reach for `npx` where you will
not: a checkout you are passing through, a colleague's repository, a tree you
are reading to decide whether to work in it. The index survives either way — it
is kept per checkout under `~/.cache/variance-authority/`, honouring
`XDG_CACHE_HOME`, not inside the tree being read — so a second `npx` run answers
out of what the first one learned.

Ask `npx` for the package, not for the binary. `@variance-authority/help` is the
name on the registry; `variance-authority-help` is the name of the command it
installs, and passing a command name where a package name goes is how `npx`
ends up reporting that a package does not exist.

## Serve it to an MCP client

With no verb, the binary speaks the protocol on stdio:

```bash
npm install --save-dev @variance-authority/help
npx variance-authority-help .
```

```json
{
  "mcpServers": {
    "workspace-api": {
      "command": "npx",
      "args": ["variance-authority-help", "."]
    }
  }
}
```

The six tools are named `docs_packages`, `docs_entrypoint`, `docs_symbol`,
`docs_uses`, `docs_search` and `docs_gaps`, and they answer in the same words as
the six verbs above.

## Write the answers to files

For readers that cannot call a tool — a chat window with a URL box, a crawler, a
person:

```bash
npm install --save-dev @variance-authority/help
npx variance-authority-help write . --out docs/api
```

Four files, and the command prints each with its size:

| file | is |
|---|---|
| `llms.txt` | the [convention](https://llmstxt.org): a title, a summary, and one link per import specifier |
| `help-index.md` | every name, its signature, its doc and who imports it |
| `help-gaps.md` | the undocumented ones anybody imports |
| `help.json` | the reading itself |

The head of a generated `llms.txt`, run against this repository:

```
# variance-authority

> Composable evidence tools for software that changes.

## @variance-authority/cli

- [@variance-authority/cli](packages/cli/src/index.ts): 103 names, 1 used across a package boundary, 69 documented

## @variance-authority/core

- [@variance-authority/core](packages/core/src/index.ts): 2 names, 1 used across a package boundary, 2 documented
- [@variance-authority/core/format](packages/core/src/format/index.ts): 102 names, 73 used across a package boundary, 70 documented
```

`--base https://github.com/you/repo/blob/main/` puts a prefix in front of every
path, for pages that will be read away from the checkout.

`help.json` holds the same reading the other three files render, so a caller can
build a different rendering without re-reading the repository.

## From a program

Two import specifiers:

| specifier | needs | holds |
|---|---|---|
| `@variance-authority/help` | a stdio pair, to serve | `serveWorkspace` and `writePages` |
| `@variance-authority/help/tools` | nothing | the six answers, as pure functions from a reading to text |

The functions in `@variance-authority/help/tools` carry no MCP dependency, so
you can call them directly, test them in isolation, or embed them in another
interface without speaking the protocol.

```bash
npm install --save-dev @variance-authority/help
```

`writePages` takes the root, the output directory, and options: `base`, the path
prefix above, and `page`, the title and summary for the generated files,
overriding what they would otherwise take from the root manifest. It returns
what it wrote.

```ts
import { writePages } from '@variance-authority/help';

for (const file of writePages('.', 'docs/api', {
  base: 'https://github.com/you/repo/blob/main/',
  page: { title: 'Our API', summary: 'What every package here publishes.' },
})) {
  console.log(`${file.at} — ${file.bytes} bytes`);
}
```

`readWorkspace` is the reading the six answers are asked of, for a program that
wants to ask more than one of them or to ask them through its own interface. It
takes the root and returns the workspace: every package, what each publishes,
and who imports it. Five options, all optional: `index`, the path of the source
index the scan keeps its parses in, when you would rather it shared one you
already have than kept its own under the checkout; `save`, whether to write what
this reading learned back to that index for the next one, on unless you say
otherwise; `changed`, the authoritative scan-root-relative file list an editor,
watcher or orchestrator already has, which skips Git status discovery; `taints`,
addition-only Sense taints for declarative module loads the language's imports
do not express; and `records`, a function handed the import
graph the scan drew on the way, for a caller that needs the arrows between files
as well as the names, so it does not scan the checkout a second time to get them.
Taints change which files a path question reaches and never manufacture symbol
bindings or usage counts. A subtractive taint is refused: a mock is relative to
one file's run and cannot be flattened into a workspace-wide source tree.

```ts
import { readWorkspace } from '@variance-authority/help';
import { search, symbol } from '@variance-authority/help/tools';

const workspace = await readWorkspace('.', { save: false });

console.log(search.run(workspace, { query: 'viewport' }));
console.log(symbol.run(workspace, { name: 'Viewport' }));
```

`refreshWorkspace` takes a previous reading and refreshes its volatile half:
symbol usage, exported names, unreadable files and the source graph all come
from a new Sense scan. Signatures, comments and README mentions are retained.
A manifest change or an added or removed exported name rebuilds that retained
documentation immediately, so a symbol introduced by the current edit is
available on the same reading. Call `readWorkspace` again when edits to existing
documentation must be visible immediately.

`serveWorkspace` starts the stdio server and returns a function that stops it.
`input` and `output` are the two streams the protocol is spoken over and default
to this process's own; override them when the host owns the transport. It runs
the volatile refresh before every tool call and rebuilds retained documentation
once per day by default. `documentationRefreshMs` changes that interval; zero
rebuilds documentation on every request.

```ts
import { serveWorkspace } from '@variance-authority/help';

const stop = serveWorkspace('.', { input: process.stdin, output: process.stdout });

process.on('SIGINT', stop);
```

## What it does not do

It does not read `dist`. A `types` target of `./dist/index.d.ts` is mapped back
through that package's own `rootDir` and `outDir` to `src/index.ts`, so what it
reports is what somebody wrote.

It does not infer. A name with no block comment above it is reported as having
none, and a search that matches nothing says so before it offers anything near
it — the near ones arrive under their own heading, counted and labelled, never
mixed into the answer to the word you typed. A README passage is returned only where the prose writes the name
as a whole word, and it arrives labelled with the file it came from.

It does not serve source. `uses` names the story, the test and the file, with
the line to open; reading them is your move, against the file as it is rather
than as it was when the reading was taken.

It does not rank on prose. `search` is a case-insensitive substring match over
names and docs, so a match is a fact about the text rather than an opinion about
the query.

It does not stop at what a manifest publishes. Most code in any checkout was
never meant to be published — 1,826 names are published in this repository and
5,540 more are exported without being published — so `search` answers in two
sections and says which is which.

---

**[@variance-authority/help](https://variance-authority.dev/reference/packages/help)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
