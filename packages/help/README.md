<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/help

**Requires:** a workspace on a disk this process can read, and — to serve it — a
client that speaks MCP over stdio. Nothing has to have been built, and nothing is
generated ahead of time.

What a workspace publishes, ranked by what imports it, answered while an agent is
working.

## The question

A library is used by somebody who has not read it, and increasingly by something
that cannot. What both need is not the README. It is which names exist, which of
them anybody actually reaches for, what each signature is, and what was written
above it — and all four are readable off the same disk the code is on.

The ranking is the part a documentation generator does not have. A generator
renders every export equally, so a thousand exports arrive as a thousand
equally-weighted facts and the one that was wanted is as likely to be last as
first. This counts how many packages in the repository import each name, which
turns the same thousand into a front door and a footnote.

That count also turns a statistic nobody acts on — *61% of names are documented* —
into a morning's work:

```
114 names cross a package boundary with nothing written above the declaration:

Viewport [interface] packages/core/src/format/environment.ts:73 — used by 15 packages: …
normalize [function] packages/core/src/rules/normalize/index.ts:58 — used by 14 packages: …
collect [function] packages/dom/src/collect.ts:183 — used by 13 packages: …
```

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | stdio, to serve | everything, plus `serveWorkspace` and `writePages` |
| `@variance-authority/help/tools` | nothing | the five answers, as pure functions from a reading to text |

The tools are pure and separately importable for the same reason the report
server's are: the question that matters — *does this answer let an agent use the
library?* — has to stay cheap to ask, and it stops being asked the moment
answering it means speaking a protocol over a pipe.

## Serve it

```bash
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

Five tools, in the order they are meant to be asked in:

| tool | takes | answers |
|---|---|---|
| `docs_packages` | nothing | every import specifier the workspace publishes, and how used and documented each is |
| `docs_entrypoint` | a package, optionally a subpath | the names one specifier opens, most-imported first |
| `docs_symbol` | a name | the import line, the place, the signature, the doc, and who imports it |
| `docs_search` | a string | names whose name or doc contains it, ranked the same way |
| `docs_gaps` | nothing | names other packages import and which say nothing about themselves |

`docs_packages` needs no argument and returns the arguments every other tool
takes. That shape is the design: a model that must guess a package name to ask
its first question will guess, and a wrong guess costs a turn and reads exactly
like a workspace that does not publish the thing.

Every request re-reads the workspace. An agent that edits a file and asks again
is the whole reason this outlives one question, and the reading is manifests and
module records rather than a compilation — twenty-six packages and fifteen
hundred names take about two hundred milliseconds.

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

The same two from a program, where `writePages` takes them as `base` and `page` —
the second overriding the title and summary the pages would otherwise take from
the root manifest:

```ts
import { writePages } from '@variance-authority/help';

writePages('.', 'docs/api', {
  base: 'https://github.com/you/repo/blob/main/',
  page: { title: 'Our API', summary: 'What every package here publishes.' },
});
```

The JSON is there because everything above it is a rendering decision somebody
will eventually disagree with, and disagreeing should cost a `JSON.parse` rather
than a fork.

## Serve it from a program

```ts
import { serveWorkspace } from '@variance-authority/help';

const stop = serveWorkspace('.', { input: process.stdin, output: process.stdout });
```

`input` and `output` are the two streams the protocol is spoken over, and they
default to this process's own. They are options rather than an assumption because
a server whose transport is hard-wired to `process.stdin` can only be tested by
starting a process, and the tests that matter here are about what the answers
say.

## What it is made of

Three parts, and none of them is new here:

- The reading is [`@variance-authority/package`](../package), which owns every
  decision about what a workspace publishes and what reaches for it.
- The framing is [`@variance-authority/mcp`](../mcp), whose protocol half is
  generic in what it serves — a JSON-RPC line is a JSON-RPC line whether the
  subject is a visual-difference report or an API.
- What is left, and what is in this package, is the five questions and the words
  the answers are written in.

## What it does not do

It does not read `dist`. A `types` target of `./dist/index.d.ts` is mapped back
through that package's own `rootDir`/`outDir` to `src/index.ts`, so what it
reports is what somebody wrote.

It does not infer. A name with no block comment above it is reported as having
none, and a search that matches nothing says so rather than returning the nearest
thing — a caller that gets nothing back has learned something true.

It does not rank on prose. `docs_search` is a case-insensitive substring match
over names and docs, so a match is a fact about the text rather than an opinion
about the query.
