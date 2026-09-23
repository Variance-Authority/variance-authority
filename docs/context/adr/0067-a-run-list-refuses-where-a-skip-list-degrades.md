# ADR-0067 — a run list refuses where a skip list degrades

**Status:** accepted
**Date:** 2026-09-19
**Relates to:** [ADR-0017 — the exit code is the interface](0017-the-exit-code-is-the-interface.md), [ADR-0062 — a skip list is bounded by what the record witnessed](0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md), [ADR-0066 — a language is a reader, not a Sense of its own](0066-a-language-is-a-reader-not-a-sense.md)

## Context

[ADR-0066](0066-a-language-is-a-reader-not-a-sense.md) made the file graph
polyglot: Python, Rust, Java, Kotlin and Swift are read into the same records as
JavaScript, and the walk in
[`reach.ts`](../../../packages/cli/src/commands/reach.ts) already answered *what
does this diff reach* for all of them. Nothing could ask it. The answer was
reachable only through the visual selector, which discards the reasoning, and
through the report, which prints it as prose about components.

Handing it to a pipe is the whole of what was missing, and it inverts a risk this
repository had only ever taken in one direction. `variance select` emits a
**skip** list: what it has never heard of is absent from its answer and the
foreign runner keeps running it, so every degradation it can suffer costs time.
A command that prints files for `xargs` emits a **run** list, where the same
degradations cost coverage — and the worst of them is indistinguishable from
success. An empty stdout piped into a runner runs nothing, exits zero, and looks
like a fast green build.

`nx affected` and `turbo run --filter` print run lists too, and both answer an
empty diff with an empty list. That is defensible in a tool a repository
configures, whose operator knows what it was pointed at. It is not defensible in
a tool asked one question by somebody else's CI step, in a checkout that
configured nothing.

## Decision

**On exit `0`, stdout is never empty. Every path that would produce an empty
answer exits `2` and writes nothing at all.**

The property holds by construction rather than by a final guard:
[`affectedBy`](../../../packages/core/src/relate/records.ts) returns the seeds among
the files it reached, so any answer that got past the refusals holds at least the
changed files themselves. There is no branch where a short list is printed.

**The refusals are the command.** Four, and each of them is a question the walk
cannot answer rather than an answer that happens to be small:

- **No diff.** A shallow clone, a ref that is not there, a directory that is not
  a checkout — all arrive as an empty diff, and an empty diff piped onward means
  *run nothing*.
- **A changed source file the graph does not hold.** A gap in the scan, never a
  file that affects nothing.
- **No changed file the graph could hold at all.** A lockfile, a Dockerfile, a
  workflow. Every one of them can repaint the whole suite, and none of them is a
  seed the walk can start from.
- **No scanner.** Named, rather than degraded into a smaller answer.

**A path no reader claims is removed before the walk and said out loud.** This is
the one place the first two refusals would collide: a walk seeded from the whole
checkout treats every changed path as in scope, so an ordinary README would fire
the scan-gap refusal. The extension set `sense` publishes decides it — a path no
language claims leaves the walk and is named on stderr, and a diff made entirely
of such paths refuses, because nothing was read rather than nothing was reached.

**The two streams carry different things and never mix.** stdout is the answer
and only the answer, one path per line. Every count, every widening and every
file left out goes to stderr, where a pipe does not see it and a person does.

**The command reads no configuration.** `variance reach` joins `watch`, `distill`
and `select` as configless, for the reason `select` is: it is asked by a
repository whose tests another runner runs and which may have configured this
tool for nothing at all. `--since` has no default, for the reason
[ADR-0017](0017-the-exit-code-is-the-interface.md) gives — guessing a ref is
guessing what a build is about to skip.

## Consequences

A Gradle project, a SwiftPM package or a `pytest` suite gets change-based
selection out of this repository with no framework integration, no probe and no
recording: one command, a `grep` and an `xargs`. The per-ecosystem knowledge —
what a Kotlin test file is called, how Maven is invoked — stays in the caller's
pipeline, where it already lives.

`2` on an empty diff means a `set -e` pipeline stops rather than passing. That is
the intended cost, and a caller that genuinely wants *no diff, no tests* writes
the `git diff --quiet` test itself, in its own words, where a reader can see the
decision.

## What this forecloses

- **A best-effort run list.** No flag degrades a refusal into a shorter list.
  The whole safety of the command is that its list is either complete or absent.
- **A default `--since`.** The ref names what the caller is comparing against and
  nothing else can know it.
- **Answering from the recording instead.** `reach` answers from structure, which
  is why it needs no history and works on the first day in any language read.
  Narrowing below the graph on what a run recorded is `select`, stays `select`,
  and stays bounded by [ADR-0062](0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md).
- **A run list that reads project configuration.** A command that answers a
  foreign runner must not fail because this tool was never set up in that
  repository.
