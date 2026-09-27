# ADR-0079 — Readings of a case are compared by what every reading of a side does

**Status:** accepted
**Date:** 2026-09-27
**Amends:** [ADR-0076](0076-a-story-is-the-order-one-case-visited.md) — its
decision sentence ("never read by anything that selects or compares") and rule
2 ("the last run replacing the earlier one").
**Relates to:** ADR-0056 (a journey is the places visited), ADR-0002 (absent is
not empty), ADR-0069 (every answer has an owner),
[`packages/sense/src/story/compare.ts`](../../../packages/sense/src/story/compare.ts),
[`packages/sense/src/instrument/story-tap.cts`](../../../packages/sense/src/instrument/story-tap.cts)

## Context

A journey drops order because `async` makes it false: two promises started
together settle in either order, so a set of places is the only claim that is
the same on every run. A story keeps order for a reader looking at one case.
ADR-0076 kept it away from selection and comparison for the reason ADR-0056
dropped it.

Two things did not fit that. A changed order is not a flake — it is what every
async case does on every run — but sometimes the order *is* the cause: the
response lands before the click on every failing run and after it on every
passing one. A reader chasing that has two routes and no way to tell the
interleaving that differs every run from the one that differs with the outcome.
And a route says where a case went, never with what, so the argument a function
got is a breakpoint away even when the code already prints it.

The visual side already has the vocabulary: `again` and `alone` read one subject
twice with one thing varied, and `a-b-testing.md` separates *one subject read
again* from *two subjects compared on purpose*, the declared axis named.

## Decision

**A case keeps its last readings, and two sets of them are compared by what is
true of every reading on one side and of no reading on the other. Everything
else that differs is counted, never listed.**

1. **Readings, not a story.** A case keeps its last 16 stories
   (`READINGS` in `story/format.cts`), each `<stem>.<written>-<pid>-<n>[.<label>].story`
   where `<stem>` digests file and name. `VARIANCE_AUTHORITY_STORY` set to a
   value other than `1` labels the run's readings; the label is sanitised to
   `[A-Za-z0-9_-]`, 40 characters. Unlabelled is spelled `1` by the CLI.
2. **A side is a set of readings.** `--compare outcome` is passed against threw,
   `last` is the newest against the one before, `<a>,<b>` is two labels. The
   first two are one case read again; labels are the declared axis of an A/B
   pair, and the label is where the user names it.
3. **Steady or counted.** A region (file, the module's region count, ordinal —
   so two texts of one file never meet), a note by text, and an order are each
   reported only when every reading of one side has it and no reading of the
   other does. Order is compared between *moments* — a declaration's first
   arrival, a module loaded, a note said — that every reading on both sides has,
   and a pair is reversed only when each side holds one order on every reading
   and the two sides hold opposite orders. Everything else is `unsteady`,
   counted by kind.
4. **One reading on a side is flagged, not refused.** `single` is set when a
   side has fewer than two readings, and the CLI says a difference may be the
   run. `last` is always single; refusing it would refuse the question.
5. **Notes are what the code says.** The tap installs one function under
   `Symbol.for('variance-authority.story.note')` on the realm global, and wraps
   `console.log|info|warn|error|debug` once. The console still prints. `vae`
   and the Eyes log call the channel when it is there. A note is `[visits taped
   before it, bucket, text]`, 4,096 per tape and 240 characters each, counted as
   `unnoted` past that. A note is not a visit and is never in the record.

## Alternatives

- **Diff two routes** (edit distance or LCS over steps). Rejected: on an async
  case the interleaving is most of the diff, and it is listed as if it were the
  finding.
- **Order as a frequency** (a pair reversed in 80% of failing runs). Rejected:
  that is a tolerance, and `flakiness.md` refuses tolerances for the reason it
  gives there — a threshold large enough to quiet noise is large enough to
  quiet the cause, and the output does not say which. All-or-nothing with the
  rest counted says what it left out.
- **Order in the journey.** Foreclosed by ADR-0056 and not reopened.
- **Arguments captured by the tap.** Rejected: the probe carries no values, a
  value accessor is the runtime cost ADR-0056 refused, and serialising
  arbitrary values is an operation nobody asked for. The code says what it
  chooses to say — a `console` line, an Eyes query with its arguments, a `vae`
  announcement — and only in a realm recording a story, which somebody named.
- **Order at region grain.** Rejected: arms of one declaration interleave with
  loop passes, so region pairs reverse between runs that took the same route.
  Declaration grain is the step a reader already reads.

## Consequences

- A comparison needs two or more readings per side to say anything about a
  side; the reader is told when it has fewer.
- A case costs up to 16 files in `coverage.stories/`; ADR-0078 still removes
  them at 14 days.
- Under the variable the realm's `console` methods are wrappers. A test that
  compares `console.log` by identity sees the wrapper; `vi.spyOn` still works
  because the wrapper looks the channel up when it prints.
- A note said in another case's continuation lands in that case's bucket: the
  tap asks the async scope before it notes, as a probe does before it writes.
