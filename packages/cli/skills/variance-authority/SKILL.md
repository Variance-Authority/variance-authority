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
| `ask` about a run (`summary`, `changes`, `composition`, `locate`, `describe`, …), `adjudicate`, `report`, `changelog`, `accept` | required | the report a finished run left |
| `ask` about a running suite (`self`, `run-signals`, `waiting`, `test-signals`, `diff --at`) | required, though never read | a watcher's address |
| `ask` about the source (`packages`, `entrypoint`, `symbol`, `uses`, `search`, `gaps`) | none | the checkout |
| `watch`, `distill`, `covering`, `index`, `select`, `reach` | none | see the reference that owns it |

The config is `variance.config.json` in the working directory, or the file
`--config <path>` names. There is no search of parent directories and no
default: a missing file is exit `2` with `cannot read the config file
variance.config.json`.

Exit codes: `ask` exits `0` for every answer, including one that describes
changes. `run`, `report` and `adjudicate` own the verdict and exit `1` when
something needs review. `2` is an operator error: a crash, a missing config, a
refused question. Do not read a `1` as a crash.

## Open the reference for the question

Read only the row your question is in. Several rows name a second file; read it
when its condition holds, not before.

| Question | Read | Then, only if |
|---|---|---|
| What did the last run find? What changed? Did my edit land? | [ask a run](references/ask-a-run.md) | you have a description, not a subject id: [locate](references/locate.md) |
| What is a suite that has not finished doing? | [live run](references/live-run.md) | nothing arrives: [producers](references/producers.md) |
| A reading, a field or a domain is unavailable | [producers](references/producers.md) | |
| Which tests ran this line? What did my change do to the cases? | [covering](references/covering.md) | |
| Which tests does this edit need, and which first? What does a distance or a `bearing` mean? | [test selection](references/test-selection.md) | the selection came back whole, missed a config file, or a recorded run times out: [selection wiring](references/selection-wiring.md) |
| What can this test be reduced to? | [distill](references/distill.md) | an input file is missing: [producers](references/producers.md) |
| What does this workspace publish? Where is a name declared, and who imports it? | [workspace API](references/workspace-api.md) | |
| The client holds an MCP connection, or you are writing its config | [MCP](references/mcp.md) | then the row for the question itself |

## Rules every answer shares

**Absent is not empty.** An unavailable domain is unknown, never an empty
reading. A missing field means the producer did not expose it; an empty list
means it measured and found nothing; a distance that could not be measured is
absent, never `0`. Every answer's header says what it read. Do not reconstruct
runtime evidence from repository files.

**Matching is lexical, and you expand the query.** `locate` and `search` match
the characters you typed against the names that were recorded or written. There
is no synonym list, no stemming and no model, so `auth` does not find a sign-in
screen whose component is `CredentialGate`. You have the ticket, the
conversation and the checkout, so you already know that `auth` here may be
written `login`, `session`, `credential`, `token` or `jwt`. Ask each candidate
as its own query, and when one comes back unmatched, ask in a different kind of
name rather than rewording the same one. Two or three short queries cost two or
three calls, and the first hit tells you the vocabulary this repository uses
for every question after it.

**Say where you are standing.** On a large repository a common word matches
everywhere the product says its own name. `--from <path>` narrows to what that
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
`$XDG_CACHE_HOME/variance-authority` when that is an absolute path; otherwise
`~/.cache/variance-authority`. Rendered images and the source index are keyed
by the bytes they came from, so a stale entry, another branch's cache or no
cache at all costs a slower answer and never a different one. The recording has
its own refresh rules, in [test selection](references/test-selection.md). Runs
prune the render cache themselves. To force a cold read, delete the directory.
A git worktree writes its own layer beneath the primary checkout's and reads
both, so deleting one checkout's cache leaves the others' in place.
