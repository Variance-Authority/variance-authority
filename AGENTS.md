# Working on this repository

A change moves through seven phases, in order. **Refine** settles what the task
is. The **inner loop** — orient, change, pre-verify, PR — is yours alone and runs
as often as it takes. The **outer loop** — validate, correct — starts when the PR
is open and other parties answer: CI, CodeRabbit, the person who asked. Anything
red sends you back into the inner loop.

Every phase opens with **look around**: questions answered by reading and
running, before acting. They are not a formality. Each one is there because
skipping it has already cost somebody a change. Every phase has a reference under
[`.agents/references/`](.agents/references/) holding its rules and their
reasons; read it when you enter the phase.

## Setup

Node 22 or newer, and Yarn 4 through Corepack — `packageManager` in the root
`package.json` pins the version. Every command runs from the repository root, in
a git checkout that has its history.

```bash
yarn install && yarn build
```

Build again after every pull. A stale `dist/` answers questions wrongly rather
than failing, and the wrong answer looks like a defect in whatever you asked
about.

The primary checkout — the first row of `git worktree list` — is shared: people
commit on `main` in it while you work, and anything you stage there lands in
their next commit. Never stage in it. Work in a worktree on a branch cut from
`origin/main`, and give the worktree its own `yarn install && yarn build`.

## 1. Refine the task — [refine](.agents/references/refine.md)

Look around:

- What was asked, by whom, and what done means, as a sentence somebody could
  check.
- Whether it is a Backlog task. If it is, Backlog governs it (below).
- For non-local work — crossing a boundary, changing a rule or an invariant,
  adding a party, building a capability: what the architecture chart in
  `.compass/` says owns it.
- What `docs/specs/`, `docs/context/adr/` and `docs/context/journal/` already
  decided, tried or rejected on the subject.
- What the field calls it, and who measured it before us:
  [`docs/context/prior-art.md`](docs/context/prior-art.md) first.
- What already does this, or most of it. A feature is aligned with the
  functionality that exists — called, extended, routed to — and new code is
  the exception: written only when the PR can show nothing existing could carry
  it. A second implementation is a defect.

Leave with the sentence of done, the kind of its PR, what existing code it is
reached from, the gate it is measured against, and only the questions that are
the asker's to answer.

## Inner loop

### 2. Orient — [orient](.agents/references/orient.md)

Look around:

- `yarn variance ask` before grep: who uses a name, what it is, where it is
  declared.
- The `// compass:` coordinate at the top of each file you will touch.
- Whose answer you need — git, the manifest, the parser, or the recording — and
  whether a stage upstream of your change already computed it.
- The tests that stand on those files: `yarn variance covering --file <path>`.
- What landed on `origin/main` since your branch point.

Leave with the files to change, the owner of every answer the change needs, and
the tests that will judge it.

### 3. Change — [change](.agents/references/change.md)

Look around:

- The tests that stand on the code, from `yarn variance covering --file
  <path>`. A test is amended or added first, and fails on the code as it is,
  before the code changes. Behaviour nothing covers is pinned green first, in
  addition to that test, not instead of it.
- Where each piece of writing goes. A top-layer page — the root `README.md` or
  `docs/` — gets its structure from
  [content flow](.agents/references/content-flow.md) before it is outlined: a
  brief, then a spine read cold by the `content-flow` reviewer. Detail goes to
  the skill reference or the JSDoc that owns it. [`docs/AGENTS.md`](docs/AGENTS.md) comes before any
  published sentence: a README, `docs/`, the site, CLI output or an error
  message.
- Whether the change reaches a published package. If it does, it carries a
  changeset — `yarn changeset` — written as it is made, not at release time; a
  change that ships nothing worth naming carries `yarn changeset --empty`. CI
  refuses a pull request that changes a package without either.
- The code rules in the reference: absent is not empty, a package is named for
  what it is for, code-unit sorting, 500 lines per file, a documented export is
  run by something, every answer has an owner, one browser and one page, no
  magic and not alone, stop only what you started, a status claim is a marker.

What the task needs, and a defect in its own diff, are fixed on its branch
before it merges; a finding it neither needs nor wrote goes on its own branch,
as [change](.agents/references/change.md) draws the line.

### 4. Pre-verify — [pre-verify](.agents/references/pre-verify.md)

Look around:

- Whether the checkout is reconciled: install and build current, new files
  tracked.
- What the change reached: the `read` lines of `yarn variance select --suite
  <slice>`. A slice it skips nothing of is the whole suite, not a wave; leave it
  to CI.
- Whether the machine is quiet before you believe a failure: a load average in
  `uptime` above the core count means re-run later.

Verify in waves, nearest first. Each wave starts only when the one before it is
green, and a red wave sends you back to the edit, then to wave 1:

```bash
yarn verify:near    # 1. lint, types, tests within two imports — repeat freely
yarn verify:rules   # 2. the repository checks, once near is green
yarn verify:far     # 3. the rest of the selection, once, before the PR
```

A green wave is not run again on unchanged code. The full `yarn verify` and
`yarn measure` are CI's: run one locally only to reproduce a check that failed
there.

Leave with three green waves, or a failure that survived reconciling the
checkout and a re-run of the one failing file.

### 5. Open the PR — [pull request](.agents/references/pull-request.md)

Look around:

- `git fetch` and rebase onto `origin/main`. What landed since you branched can
  change every answer CI is about to give. If the rebase brought anything in,
  pre-verify again.
- Open PRs touching the same files: `gh pr list --json number,title,files`.
- The PR's kind, its title's prefix, and whether it carries everything that
  kind needs, as [pull request](.agents/references/pull-request.md) lists them.

Write the body to
[`.github/pull_request_template.md`](.github/pull_request_template.md): the
problem, the solution, and one row per block the change touches. Before
anything is pushed, three subagents with no other context review the change,
each for one question: does the body say the problem and the solution, should the change
happen at all, and does the diff do what the body says. A change that writes a
top-layer page gets a fourth, the `content-flow` reviewer, and it runs first:
the other three wait until the page's structure passes. Fix what they mark
blocking and run them again until none does; a finding still blocking after the
second round is yours to fix or set aside, and every finding not fixed is named
in the body. Then push the branch and open the PR, so CodeRabbit reviews
finished work. Never push to `main`.

## Outer loop — [validate and correct](.agents/references/outer-loop.md)

Each cycle on the PR, from opening it or from picking up a failure, a comment
or a conflict, puts the `agent:debugging` label on. Handing over swaps it for
`agent:done`; stopping short of that takes it off and puts nothing on. Nothing
announces a PR that has finished passing, so a cycle that is not stopping
blocked ends by watching every check until it has finished,
`gh pr checks <n> --watch`, never with `agent:debugging` left on.

### 6. Validate

Look around:

- Every check, until each has finished: `gh pr checks <n> --watch`.
- CodeRabbit's inline comments, once its check reads `Review completed`.
- The coverage and "What this change might do" comments CI posts. Do they
  describe the change you meant to make?

### 7. Correct

Look around:

- The failing check's log, and the same check on `main`'s latest run.
- The code each CodeRabbit comment names, read before you decide.

A red check is yours: reproduce it, fix it on the branch and go back to
pre-verify. A failure is not called flaky, pre-existing or unrelated without the
same failure on `main`. A CodeRabbit comment is a signal, not an instruction: fix
what is real, set aside what is not, and never reply to or resolve a thread.

A PR is handed over only when every check is green and every finding is
classified. The report starts from the task as it was set — where it stands,
what is not done — and ends with what you need from the person who asked.

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.50.1 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management. Backlog governs
task processing, not repository orientation.

Invoke Backlog only when the request processes a Backlog task: searching,
reading, creating or updating one, or executing or finalizing work already
identified as a Backlog task. Reading `AGENTS.md` or `docs/context/`, inspecting
the checkout, locating files or tools, answering an ad hoc question, and making
an ad hoc change are not Backlog task processing and must not invoke it.

At the start of Backlog task processing, run
`./node_modules/.bin/backlog instructions overview` and
use it to decide whether to search, read, create or update tasks. Run Backlog
commands independently from orientation and context reads so a CLI failure
cannot prevent those reads.

Before task lifecycle actions, read the matching detailed guide:
- `./node_modules/.bin/backlog instructions task-creation` before creating or splitting tasks
- `./node_modules/.bin/backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `./node_modules/.bin/backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `./node_modules/.bin/backlog <command> --help` before running unfamiliar
commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
