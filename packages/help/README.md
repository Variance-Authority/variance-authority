<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/help

> Find the public name, signature, documentation, consumers and call sites of an exported TypeScript workspace symbol, over MCP.

Part of [Variance Authority](https://variance-authority.dev), a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

It reads TypeScript source across a workspace and answers what a name is, where
it is declared, who imports it, and where the repository already writes it.
Nothing has to have been built first, and nothing is generated ahead of time.

Use this package when a person or coding agent needs the public name,
signature, documentation, consumers, or call sites of an exported symbol: a
function, class, interface, type, or constant a package makes public. A consumer
is any package in the workspace whose source imports that symbol. This package
re-reads the checkout on every MCP request, ranks names by how many consumers
they have, and reports undocumented names separately.

It answers two questions about a symbol, and they are different questions. What
a name is supposed to be comes off the declaration: its signature and the block
comment above it. How the name is actually written here comes off the call
sites, and that is the answer a stale doc comment cannot spoil.

## What it provides

A reader does not need every name in a package's surface — the exports its
manifest opens — weighted equally. The useful first answer is which names
exist, which packages reach them, what their signatures are, and what the
source says above each declaration. All four are read from the same checkout,
without a build or a generated documentation site.

The ranking counts how many packages in the repository import each name. A
frequently imported symbol becomes a front door; a symbol with no external use
stays available without taking space from the first answer.

### Where the declaration says nothing

A name with no block comment above it is reported as undocumented, and before
reporting it the server looks in one more place: the nearest `README.md` above
the declaring file. Where that prose names the symbol as a whole word, the
passage comes back labelled with the file and line it was read from.

The passage is never presented as the symbol's documentation, and it never
removes the name from `docs_gaps`. A paragraph written about a package is
written for a different reader than a comment written above a function, and
counting the first as the second would empty the work queue without closing it.

### Where the workspace already writes it

`docs_uses` answers with the file and line of every import, and it separates the
files written to *show* a name in use — stories and tests — from the ones that
depend on it. Both are pointed at rather than quoted: the path and the line are
what an editor opens, and re-serving a file's text would spend a context window
on bytes the caller can read in one cheap operation.

Pass `from` — the file you are working in — and the sites come back ordered by
how many leading path segments they share with it. That is a claim about the
filesystem rather than the import graph, and it orders the sites without
removing one: every place that imports the name still comes back. The `from` on
`docs_search` is a different argument doing a different job — it is a start
point, it walks the imports, and it removes. Two arguments spelled the same way
is a real cost, and the alternative was worse: the file you are working in is
what you pass in both cases, and a reader who had to remember which tool called
it `near` would guess.

### The work queue

The same ranking turns undocumented names into a concrete work queue:

```
Names that cross a package boundary with nothing written above the declaration:

Viewport [interface] packages/core/src/format/environment.ts:73 — used by 15 packages: …
normalize [function] packages/core/src/rules/normalize/index.ts:58 — used by 14 packages: …
collect [function] packages/dom/src/collect.ts:183 — used by 13 packages: …
```

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | stdio, to serve | `serveWorkspace` and `writePages` |
| `@variance-authority/help/tools` | nothing | the six answers, as pure functions from a reading to text |

The tools in `@variance-authority/help/tools` are plain functions with no MCP
dependency, so they can be called directly, tested in isolation, or embedded
in another interface without speaking the protocol.

## Ask one question

In a repository that depends on this package, the binary is on the path:

```bash
yarn add -D @variance-authority/help
yarn exec variance-authority-help search viewport
```

Six verbs, taking the same arguments as the six tools below and answering in the
same words: `packages`, `entrypoint`, `symbol`, `uses`, `search`, `gaps`. Add
`--root <dir>` when you are not standing in the workspace.

### On a repository that has never heard of this

```bash
npx @variance-authority/help search session --root ../shadow
```

Install it where you will ask more than once, and reach for `npx` where you will
not: a checkout you are passing through, a colleague's repository, a tree you are
reading to decide whether to work in it. The index survives either way — it is
kept per checkout under `~/.cache/variance-authority/`, not inside the tree being
read — so a second `npx` run answers out of what the first one learned.

Ask `npx` for the package, not for the binary. `@variance-authority/help` is the
name on the registry; `variance-authority-help` is the name of the command it
installs, and passing a command name where a package name goes is how `npx`
ends up reporting that a package does not exist.

Nothing has to be published, or be a workspace, or be an npm project at all.
A repository with no manifest at its root publishes nothing, so the published
half of every answer is empty and the exported half carries it — which is the
half that matters in a tree whose TypeScript sits in a subdirectory beside
something else entirely.

They exist because a client that holds a connection open all session is one of
three callers and not the common one. An agent with a shell, or a person with a
question, wants one answer now and should not have to edit a config file to get
it.

## Serve it

```bash
npm install --save-dev @variance-authority/help
variance-authority-help .
```

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

Six tools, in the order they are meant to be asked in:

| tool | takes | answers |
|---|---|---|
| `docs_packages` | nothing | every import specifier the workspace publishes, and how heavily used and how well documented each is |
| `docs_entrypoint` | a package, optionally a subpath | the names one specifier opens, most-imported first |
| `docs_symbol` | a name | the import line, the place, the signature, the doc — or the README passage that names it — and who imports it |
| `docs_uses` | a name, optionally the file you are in | every place that imports it, stories and tests listed apart, nearest first |
| `docs_search` | a string, optionally a path to start from | published names whose name or doc contains it, ranked the same way, then the names the repository exports without publishing, with a file and a line |
| `docs_gaps` | nothing | names other packages import that say nothing about themselves |

`docs_packages` takes no argument and returns the import specifiers every
other tool takes as input, so it is the natural first call.

Every request re-reads the workspace, so an answer always reflects the files on
disk right now, not the ones read at boot. The read is manifests and module
records, not a compilation, and the module records come from the source index
`@variance-authority/sense` keeps: git names each file's content without opening
it, the digest names what parsing that content produced, and a file that did not
change is never opened twice. A repository where nothing moved answers out of
that index; one where ten files moved parses ten files.

## Write it

For the readers that cannot call a tool — a chat window with a URL box, a
crawler, a person:

```bash
variance-authority-help write . --out docs/api
```

| file | is |
|---|---|
| `llms.txt` | the [convention](https://llmstxt.org): a title, a summary, and one link per entrypoint |
| `help-index.md` | every name, its signature, its doc and its audience |
| `help-gaps.md` | the undocumented ones anybody imports |
| `help.json` | the reading itself |

`--base https://github.com/you/repo/blob/main/` puts a prefix in front of every
path, for pages that will be read away from the checkout.

From a program, `writePages` takes that same prefix as `base`, plus a `page` —
the title and summary for the generated files above, overriding what they would
otherwise take from the root manifest:

```ts
import { writePages } from '@variance-authority/help';

writePages('.', 'docs/api', {
  base: 'https://github.com/you/repo/blob/main/',
  page: { title: 'Our API', summary: 'What every package here publishes.' },
});
```

`help.json` holds the same reading the other three files render. Parsing it
lets a caller build a different rendering without re-reading the workspace.

## Serve it from a program

```ts
import { serveWorkspace } from '@variance-authority/help';

const stop = serveWorkspace('.', { input: process.stdin, output: process.stdout });
```

`input` and `output` are the two streams the protocol is spoken over, and they
default to this process's own. Override them when embedding the server in a host
that owns the transport or process streams.

## What it is made of

Three parts, and none of them is new here:

- The reading is `@variance-authority/package`, which owns every
  decision about what a workspace publishes and what reaches for it.
- The framing is `@variance-authority/mcp`, whose protocol half is
  generic in what it serves — a JSON-RPC line is a JSON-RPC line whether the
  subject is a visual-difference report or an API.
- What is left, and what is in this package, is the six questions and the words
  the answers are written in.

## What it does not do

It does not read `dist`. A `types` target of `./dist/index.d.ts` is mapped back
through that package's own `rootDir` and `outDir` to `src/index.ts`, so what it
reports is what somebody wrote.

It does not infer. A name with no block comment above it is reported as having
none, and a search that matches nothing says so rather than returning the nearest
thing — a caller that gets nothing back has learned something true. A README
passage is returned only where the prose writes the name as a whole word, and it
arrives labelled with the file it came from.

It does not serve source. `docs_uses` names the story, the test and the file, with
the line to open; reading them is the caller's move, against the file as it is
rather than as it was when the reading was taken.

It does not rank on prose. `docs_search` is a case-insensitive substring match
over names and docs, so a match is a fact about the text rather than an opinion
about the query.

It does not stop at the surface. Most code in any checkout was never something
to publish — a few hundred names are published here and five thousand are
exported — so `docs_search` answers in two sections and says which is which. A
published name is API and carries its specifier; an exported one carries a file
and a line, because nothing else was read for it.


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

`from` answers only from the files that path reaches along the imports, at any
depth. `to` is the other direction, and answers only from the files that reach
it — the one to reach for when you have the helper and want its callers. Give
both and you get both areas, unioned: two entry points of one application share
almost no file, so intersecting them would answer nothing about a question that
named two places.

A path is a path, at three widths and no others — `src/a/File.ts` is that file,
`src/a/*` is that folder's own files, `src/a/` is everything under it. A path
the checkout does not hold is refused by name. You are never quietly answered
about the whole repository under a heading you would read as *your area*.

This removes names rather than ranking them down, which is the point: an empty
answer is then a fact about the area, and the answer says how many files it
looked in so you can place the count it gives you.

---

**[@variance-authority/help](https://variance-authority.dev/reference/packages/help)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT