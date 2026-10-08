# Use the packages your project already installed

Your project's tech stack is the packages its code builds on and builds with.
[Variance Authority](README.md) reads it from your checkout: which packages the
file you are editing can already use, which installed package does a job, the
signature of a name at the version in `node_modules`, and the agent skills a
package's authors ship with it. Your agent asks with `variance ask stack`,
`search` and `symbol`, or through the same tools on the MCP server, before it
writes code against a library. Every answer comes from the files you installed.
Nothing is fetched and nothing is installed for you.

An agent that does not ask writes against the library it remembers. That is
often a different major version from the one in your lockfile, and sometimes a
different library: a second date package beside the one the project already
uses, or a direct import of a package the project wraps. Documentation from the
web describes the latest release. Your build uses the release you installed, and
only the workspace that declares a package can import it.

## Ask what a file can already use

Run `variance index` once to build the [source index](source-index.md). It also
records every package a workspace manifest declares, resolved to what is
installed. Then ask from the file you are about to edit:

```bash
variance ask stack --from src/env.ts
```

```text
2 packages usable from src/env.ts, under package.json: 1 imported, 1 declared and not imported, 0 with imports not read.
1 package ships agent skills, each listed under its package with its SKILL.md.
Rows 1–2.

Imported here:
  dotenv@17.4.2 · runtime · dependency in package.json · imported 1× (first src/env.ts:1)
    skill dotenv: node_modules/dotenv/skills/dotenv/SKILL.md — Load environment variables from a .env file into process.env for Node.js applications.
    skill dotenvx: node_modules/dotenv/skills/dotenvx/SKILL.md — Use dotenvx to run commands with environment variables, manage multiple .env files, expand variables, and encrypt env files for safe commits and CI/CD.

Declared, not imported here:
  picocolors@1.1.1 · runtime · dependency in package.json · not imported

No more rows.
```

The list comes from the manifest that owns the path, so in a monorepo it is the
packages this workspace can import, not everything in the root lockfile. Each
row gives the installed version, whether the package is a runtime, dev or
types-only dependency, and how many files import it, with the first import
site. A package that is declared and never imported is listed apart: it is
installed, and nothing uses it yet. Ask this before your agent adds a
dependency.

## Find a package by the job it does

`variance ask search --query "<words>"` searches your own code first. After it,
a separate section lists the installed packages whose own words describe the
query: the `description` and `keywords` in their `package.json`, the headings
of their README, and the words inside their exported names. Words are matched by stem, so `encrypt`
finds `encrypted`. A package is listed when it has at least half of the query's
words, best first.

```text
dotenv @17.4.2 · dependency in package.json · imported 1× (first src/env.ts:1) — Loads environment variables from .env file [holds: env, files]
```

That is the first line of the answer to `--query "env files"`. The
words in brackets are the ones the package has. Pass `--from` with a path and the
third-party section keeps only the packages the workspaces around that path can
import. There is no model and no synonym list: a package that never writes your
words is not found by them. Ask again with the words a package's author would
use.

## Read the signature you installed

`variance ask symbol --name <name> --package <package>` prints the declaration
of an installed name: its signature and its full JSDoc, from the declaration
file TypeScript's resolver picks for that package at that version. When the types come
from a separate `@types` package, the answer names both packages. A package
that ships no declarations has no signature to read. For that package the
answer gives the path and line count of its `README.md` and quotes the README
passage that names the symbol, marked as coming from the README.

## Read the skills a package ships

Some packages ship agent skills inside the npm package, in
`skills/<name>/SKILL.md` beside their `package.json`. That is the layout
[TanStack Intent](https://tanstack.com/intent/latest) set for npm, so a skill
is versioned with the code it describes.

`stack` lists those skills under their package, one line each: the skill's
name, the file, and the first sentence of the description in its front matter,
which is what an agent needs to decide whether to open it. The rest stays in
the file until your agent reads it, from `node_modules`, at the installed
version. `search` does not list skills or match their words. Nothing is copied into your agent's configuration and no
skill is installed: the list is rebuilt from what is in `node_modules` each time
`variance index` runs, so a skill leaves with the package version that shipped
it.

## Where the answer stops

- **Packages a manifest declares.** A workspace's own dependencies are listed
  and searched. A package installed only because another package depends on it
  is not.
- **What `variance index` read.** The packages, their declarations and their
  skills are read when the index is refreshed, not at question time. An answer
  that comes from an older reading says what it did not read and that
  `variance index` reads it.
- **Skills where packages publish them.** Only `skills/<name>/SKILL.md` beside
  the package's `package.json` is listed. A package that keeps a skill
  elsewhere and installs it with its own command, as Playwright does for its
  CLI skills, is not listed.
- **The installed version, nothing newer.** A package that is not installed is
  not known, and a newer release is not described.

The same questions are MCP tools — `docs_stack`, `docs_search` and
`docs_symbol` — listed with the rest in [the questions an agent can
ask](agent-questions.md). To find code in your own repository rather than in its
dependencies, start with [orientation](orientation.md).
