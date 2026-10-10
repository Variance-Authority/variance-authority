---
name: variance-authority
description: How to use `variance`, the Variance Authority CLI. Read it before you run a `variance` command.
---

# Variance Authority

Every command here reads. It reads a file a run left, a watcher that is still
listening, the test-selection recording, or the checkout's source. None of them
renders, navigates, clicks, replays an event or starts a suite. When an answer
is missing, connect the producer that owns it and re-run the suite with the
project's own runner. Never drive the page from here to manufacture the
reading. The distillation loop does rerun a test: that is an experiment you
run, and its evidence comes back through the same read-only commands.

## Run the installed binary

`variance` is the `bin` of `@variance-authority/cli`, installed as a
devDependency and never globally. Run it through the package manager —
`npm exec variance`, `yarn variance`, `pnpm exec variance`. A bare `variance`,
as the commands in this skill are written, is on `PATH` only inside a package
script. If the package is missing, add it as a devDependency with the project's
package manager.

`variance ask` with no question prints every question and what each one needs.
It reads no config and no run, so it is the whole install check.

## What each command needs

| Command | `variance.config.json` | Other input |
|---|---|---|
| `ask` about a run (`summary`, `changes`, `composition`, `locate`, `describe`, …), `ask costs`, `adjudicate`, `report`, `changelog`, `accept` | required | the report a finished run left; for `costs`, the mainline's published costs unless you name a report |
| `ask` about a running suite (`self`, `run-signals`, `waiting`, `test-signals`, `diff --at`) | required, though never read | a watcher's address |
| `ask` about the source (`packages`, `entrypoint`, `symbol`, `uses`, `search`, `grep`, `gaps`, `orient`, `journey-map`, `stack`, `slowest-tests`) | none | the checkout |
| `watch`, `distill`, `reach` | none | see the reference that owns it |
| `index` | none | the checkout; it writes what [test selection](references/test-selection.md) and [orient](references/orient.md) read |
| `covering`, `story`, `select`, `coverage`, `review` | optional; only the root file's `suites` and `cacheRoot` are read; `covering` also reads `names` | the test-selection recording; with more than one suite declared, `--suite <name>`; `variance --help` lists the flags of `coverage` and `review` |
| `carry` | optional; with `--config`, its baselines and report | what the host moves between jobs; `variance --help` lists its flags |
| `layers`, `restrictions` | none | the checkout; `variance --help` lists their flags |

The config is `variance.config.json` in the working directory, or the file
`--config <path>` names. There is no search of parent directories and no
default: a missing file is exit `2` with `cannot read the config file
variance.config.json`.

Exit codes: `ask` exits `0` for every answer, including one that describes
changes. `run`, `report` and `adjudicate` own the verdict and exit `1` when
something needs review, and `restrictions` exits `1` when a rule is broken.
`2` is an operator error: a crash, a missing config, a refused question. Do
not read a `1` as a crash.

## Open the reference for the question

Read only the row your question is in. Several rows name a second file; read it
when its condition holds, not before.

| Question | Read | Then, only if |
|---|---|---|
| What did the last run find, and what changed? | [ask a run](references/ask-a-run.md) | you have a description, not a subject id: [locate](references/locate.md) |
| I changed UI code. Did the edit land, what else moved, and which declaration moved it? | [check an edit](references/check-an-edit.md) | |
| What is a suite that has not finished doing? | [live run](references/live-run.md) | nothing arrives: [producers](references/producers.md) |
| A reading, a field or a domain is unavailable | [producers](references/producers.md) | |
| Which tests ran this line? What did my change do to the cases? | [covering](references/covering.md) | |
| Which of them ran it with discounted prices mocked or a flag on? What state did a test run under, and where is its flag-off twin? | [case preconditions](references/case-preconditions.md) | |
| Where does this one test, or the few I am looking into, go, and in what order? | [story](references/story.md) | |
| Which tests does this edit need, and which first? What does a distance or a `bearing` mean? | [test selection](references/test-selection.md) | you are writing a suite's `before` or `relations`, the selection came back whole, missed a config file, or a recorded run times out: [selection wiring](references/selection-wiring.md); you need distances, the `because` trail or a diff that is not a ref: [selection API](references/selection-api.md) |
| What can this test be reduced to? How much of what each test file loads does it use, as percentiles across a suite? | [distill](references/distill.md) | an input file is missing: [producers](references/producers.md) |
| What does this workspace publish? Where is a name declared, and who imports it? Where are the words of a task, and which packages are they in? | [workspace API](references/workspace-api.md) | you need why a name exists or what it connects to: [what is written about a name](references/written-about-a-name.md) |
| Where am I in this codebase, what runs here, what can this file import, and which tests are slowest? | [orient](references/orient.md) | |
| The client holds an MCP connection, or you are writing its config | [MCP](references/mcp.md) | then the row for the question itself |

## Rules every answer shares

**Absent is not empty.** An unavailable domain is unknown, never an empty
reading. A missing field means the producer did not expose it; an empty list
means it measured and found nothing; a distance that could not be measured is
absent, never `0`. Every answer's header names what it read. Do not reconstruct
runtime evidence from repository files.

**Matching is lexical, and you expand the query.** `locate` and `search` match
the characters you typed, with no synonyms and no model, so `auth` does not find
a sign-in screen whose component is `CredentialGate`. Ask each likely spelling —
`login`, `session`, `credential`, `token` — as its own short query, and use the
vocabulary of the first hit for every question after it.

**Say where you are standing.** On a large repository a common word matches
everywhere the product uses its own name. `--from <path>` narrows to what that
path imports, at any depth; `--to <path>` to what imports it. Give both and the
two areas are combined, not intersected. A path has three widths and no others:
`src/a/File.ts` is that file, `src/a/*` is that folder's own files, `src/a/` is
everything under it at any depth. Write the parent with the file name —
`Provider.tsx` alone is not unique. A path is a fact about the source tree, so
ask from a checkout at the revision you are asking about.

**A distance is a hop count.** Every `--at-distance` and every distance range
is a count of imports: `2`, `0-2` (no more than two), `3-` (three and beyond).
Zero is a test whose own source changed.

## The cache

One directory keeps what can be rebuilt from the checkout: rendered images, the
test-selection recording, and the source index. It is `cacheRoot` in the
`variance.config.json` at the repository root; otherwise
`$VARIANCE_AUTHORITY_CACHE` when that is an absolute path; otherwise
`node_modules/.cache/variance-authority` inside the checkout, which a sandbox
that allows writes in the working tree allows too. Do not set
`XDG_CACHE_HOME` to make a run pass: it is not read. Rendered images and the source index are keyed
by the bytes they came from, so a stale entry, another branch's cache or no
cache at all costs a slower answer and never a different one. The recording has
its own refresh rules, in [test selection](references/test-selection.md). Runs
prune the render cache themselves. To force a cold read, delete the directory.
A git worktree writes its own layer beneath the primary checkout's and reads
both, so deleting one checkout's cache leaves the others' in place.
