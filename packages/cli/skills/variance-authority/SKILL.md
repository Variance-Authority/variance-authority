---
name: variance-authority
description: How to use `variance`, the Variance Authority CLI. Read it before you run a `variance` command.
---

# Variance Authority

Every command here reads. It reads a file a run left, a watcher that is still
listening, the test-selection recording, or the checkout's source. None of them
renders, navigates, clicks, replays an event or starts a suite. Never drive the
page from here to manufacture the reading. The distillation loop does rerun a
test: that is an experiment you run, and its evidence comes back through the
same read-only commands.

## Questions about the code

`variance ask` answers about the source `variance index` read. These are its
main questions; pick the one that fits what you hold, each is one command:

| You hold | Ask | Example |
|---|---|---|
| A task naming a product label and a version or state value | [the files containing both](references/code-orientation.md#combine-text-clues) | `variance ask intersection 'grep --query "Acme Chat" --from src/' 'grep --query "v7" --from src/'` |
| Any other task text, with the paths and code names in it | [what its words name, what each file they name declares, and the areas the rest point to](references/workspace-classify.md) | `variance ask classify --query 'retry in src/billing/invoice.ts and PaymentRetry'` |
| Nothing yet | [the map: packages, areas, layers](references/orient.md#orient) | `variance ask orient` |
| A file | [its place on that map, and what it declares on which lines](references/orient.md#orient) | `variance ask orient --files src/billing/invoice.ts` |
| What a thing does | [the names that do it](references/workspace-search.md) | `variance ask search --query "retry payment" --from src/billing/` |
| A name, or several | [where each is declared: `--name <name>[,...]`](references/workspace-symbol.md) | `variance ask symbol --name PaymentRetry,RetryPolicy` |
| A name | [every file that imports it; `--from` sorts them, it does not narrow](references/workspace-uses.md) | `variance ask uses --name PaymentRetry` |
| A name and an area | [the files there that import it](references/workspace-discover.md) | `variance ask discover --imports src/billing/retry.ts#PaymentRetry --path '^src/checkout/'` |
| A file | [what it reaches through its imports, nearest first; `--declares <regex>` keeps the ones declaring a name](references/workspace-discover.md) | `variance ask discover --from src/billing/invoice.ts --declares Retry` |
| A file | [what reaches it through imports](references/workspace-discover.md) | `variance ask discover --to src/billing/invoice.ts` |
| Two files | [the files on import paths between them](references/code-orientation.md) | `variance ask discover --from src/PriceCard.tsx --to src/pricing/price.ts` |
| Two questions | [the files both answer](references/workspace-intersection.md) | `variance ask intersection 'symbol --name PaymentRetry' 'discover --from src/checkout/'` |
| A file or directory and text to find only there | [the matching lines](references/workspace-discover.md) | `variance ask discover --path '^src/billing/' --text retryCount` |
| A string or a pattern | [the source lines that hold it](references/workspace-grep.md) | `variance ask grep --query 'retryCount' --from src/billing/` |
| Text nothing in the source imports: YAML, JSON, Markdown, shell, workflows, logs | not `variance`: `rg` or `git grep` | `rg 'retryCount' .github/` |

## Fill a gap with a run of what it names

When an answer names missing recording evidence, follow
[the gap it names](references/recording-gaps.md). That reference gives the
bounded run or fetch for each gap.

## Run the installed binary

`variance` is the `bin` of `@variance-authority/cli`, installed as a
devDependency and never globally. Run it through the package manager —
`npm exec variance`, `yarn variance`, `pnpm exec variance`. A bare `variance`,
as the commands in this skill are written, is on `PATH` only inside a package
script. Yarn 2 and later have no `-s`: `yarn variance` already prints only the
CLI's output, and `yarn -s variance` fails before the CLI starts. If the
package is missing, add it as a devDependency with the project's
package manager.

Bare `variance ask` prints every question and what each one needs. It reads no
config and no run, so it is the whole install check. Question arguments such as
`--query` and `--to` require a question first: `variance ask <question> ...`.
Without it, the command prints a short diagnostic and exits `2`. Explicit
`variance ask --help` still prints help.

## What each command needs

| Command | `variance.config.json` | Other input |
|---|---|---|
| `ask` about a run (`summary`, `changes`, `composition`, `locate`, `describe`, …), `ask costs`, `ask decisions`, `ask concerns`, `adjudicate`, `report`, `changelog`, `accept` | required | the report a finished run left; for `costs`, the mainline's published costs unless you name a report; for `decisions` and `concerns`, and `changelog` on a `remote` store, the review deployment, read with the share token |
| `ask` about a running suite (`self`, `run-signals`, `waiting`, `test-signals`, `ran`, `diff --at`) | required, though never read | a watcher's address; for `ran`, the checkout the application was built from |
| `trace [--format otlp] [--suite <name>]` | none | reads the nearest recording and prints a run as OTLP/JSON spans — run, file, phase, case — for any trace viewer; a file whose runner gave no start has no span, and a run with none says so on stderr |
| `ask` about the source (`packages`, `entrypoint`, `symbol`, `uses`, `search`, `grep`, `discover`, `intersection`, `gaps`, `orient`, `journey-map`, `test-composition`, `test-claims`, `containment`, `stack`, `slowest-tests`, `retried-tests`, `not-run`) | none | what `variance index` published: a question never updates it, so after you edit, run `variance index`, then ask ([workspace API](references/workspace-api.md)) |
| `watch`, `distill`, `reach` | none | see the reference that owns it |
| `index` | none | the checkout; it writes what [test selection](references/test-selection.md) and [orient](references/orient.md) read |
| `covering`, `story`, `select`, `coverage`, `review` | optional; only the root file's `suites` and `cacheRoot` are read | the test-selection recording; with more than one suite declared, `--suite <name>`; `variance --help` lists the flags of `coverage` and `review` |
| `carry` | optional; with `--config`, its baselines and report | what the host moves between jobs; `variance --help` lists its flags |
| `layers`, `restrictions` | none | the checkout; `variance --help` lists their flags |
| `journeys inspect` | none | the record whose storage directory is read |

The config is `variance.config.json` in the working directory, or the file
`--config <path>` names. There is no search of parent directories and no
default: a missing file is exit `2` with `cannot read the config file
variance.config.json`.

Exit codes: `ask` exits `0` for every answer, including one that describes
changes. `run`, `report` and `adjudicate` own the verdict and exit `1` when
something needs review, `restrictions` exits `1` when a rule is broken, and
`review --fail-on-uncovered` exits `1` when a changed function holds code no
case ran, and `review --fail-on-lost` when regions the mainline ran no longer
run. `2` is an operator error: a crash, a missing config, a refused question. Do
not read a `1` as a crash.

## Open the reference for the question

Read only the row your question is in. Several rows name a second file; read it
when its condition holds, not before.

| Question | Read | Then, only if |
|---|---|---|
| What did the last run find, and what changed? What did review decide on a subject? | [ask a run](references/ask-a-run.md) | you have a description, not a subject id: [locate](references/locate.md) |
| I changed UI code. Did the edit land, what else moved, and which declaration moved it? | [check an edit](references/check-an-edit.md) | |
| What is a suite that has not finished doing? | [live run](references/live-run.md) | nothing arrives: [producers](references/producers.md) |
| A reading, a field or a domain is unavailable | [producers](references/producers.md) | |
| Which sections occupy a record's bytes? | [record storage](references/record-storage.md) | |
| Which tests ran this line? What did my change do to the cases? | [covering](references/covering.md) | |
| An answer ended with a `Gap`. What runs next, and what does it cost? Which reading answers this question at all? | [Fast, Smart, Deep](references/fsd.md) | the gap names Deep: [story](references/story.md) |
| Which of them ran it with discounted prices mocked or a flag on? What state did a test run under? | [case preconditions](references/case-preconditions.md) | |
| Where does this one test, or the few I am looking into, go, and in what order? What was each function handed, and where did this object come from? | [story](references/story.md) | |
| Which tests does this edit need, and which first? What does a distance or a `bearing` mean? | [test selection](references/test-selection.md) | you are writing a suite's `before` or `relations`, the selection came back whole, missed a config file, or a recorded run times out: [selection wiring](references/selection-wiring.md); you need distances, the `because` trail or a diff that is not a ref: [selection API](references/selection-api.md) |
| What can this test be reduced to? How much of what each test file loads does it use, as percentiles across a suite? | [distill](references/distill.md) | an input file is missing: [producers](references/producers.md) |
| Where should a coding task start? | [code orientation](references/code-orientation.md) | you need a question's complete flags: its link in [the table above](#questions-about-the-code) |
| Which binary asks a source question, and what does it need before the first one? How literally does an answer read? | [workspace API](references/workspace-api.md) | you need why a name exists or what it connects to: [what is written about a name](references/written-about-a-name.md) |
| Where am I in this codebase, what runs here, what does this file declare and on which lines, what can it import, and which tests are slowest? | [orient](references/orient.md) | |
| The client holds an MCP connection, or you are writing its config | [MCP](references/mcp.md) | then the row for the question itself |
| A Cloudflare tribunal needs setting up, a token, or its Access values; CI says the ingest token is not set | [deploy a tribunal](references/deploy-a-tribunal.md) | |

## Follow a golden path

For an outcome spanning several questions, follow
[its workflow](references/workflows.md). Each path links its site guide and
the references for its steps.

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
vocabulary of the first hit for every question after it. A word under three
letters has no stem, so the reading of a description only keeps its place: ask
`session store`, not `session id store`. It still counts as written, so keep it
when it spells a name or a phrase: `node id` finds `NodeId`.

**`search` lists candidates, not every matching source line.** Ask
`grep --query <pattern> --from <path>` for source lines. Text outside the
source index takes `rg` or `git grep`, as the workspace reference explains.

**Say where you are standing.** On a large repository a common word matches
everywhere the product uses its own name. On `search` and `grep`,
`--from <path>` narrows to what that path imports, at any depth; `--to <path>`
to what imports it. Give both and the two areas are combined. `discover`
intersects its operands instead. A path has three widths and no others:
`src/a/File.ts` is that file, `src/a/*` is that folder's own files, `src/a/` is
everything under it at any depth. Write the parent with the file name —
`Provider.tsx` alone is not unique. A path is a fact about the source tree, so
ask from a checkout at the revision you are asking about.

**Name the code before you open it.** Ask `search` for meaning, `symbol` for
a name, or `discover --path <regex> --declares <regex>` for declarations in
an area. Once an answer names a plausible feature owner, read its named lines
and imports; these verbs are choices, not a sequence to complete first.
Find the next responsibility by crossing what you know, with the `discover`
and `intersection` rows of [the table](#questions-about-the-code);
`discover --imports` follows re-exports too. Take import names from the source
you read.
A historical symptom may be gone:
establish the current feature's owners before searching for the old predicate.
A file explicitly named by the task can be read directly. Any other file no
answer named takes `orient --files <path>` before the read.

**The uses of a name you change are part of the change.** Before you change
what a name takes, returns or means, or rename it, list the files that import
it: `uses --name <name> --file <declaring file>`, widened with `--limit` until
no row is left unshown. Each one is in the diff, or the change names
it as left alone and says why. A change that reaches some of those files and
not the others looks finished and leaves them disagreeing. A compiler catches
an importer a changed signature breaks; a changed meaning compiles, so
`covering --file <importer>` names the tests to run for each. `uses` reads
imports, through re-exports, but not `require` calls, a namespace passed on
whole, or a call through a qualified path. For those, and for a call the type
checker has to infer, use the language's find-references on the declaration
`uses` names.

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
A git worktree writes its own layer in its own cache and reads the primary
checkout's too, so deleting one checkout's cache leaves the others' in place.
