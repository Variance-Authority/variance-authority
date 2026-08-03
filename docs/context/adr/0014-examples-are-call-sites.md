# ADR-0014 — An example is a call site, and is compiled like one

**Status:** accepted
**Date:** 2026-08-03
**Extends:** ADR-0013 (packages are named for their requirements)

## Context

Eleven of the twenty `ts` examples in this repository's package READMEs did not
compile. Not one of them was a typo. Each named an API that had existed and had
since changed:

| README | what it called | what exists |
|---|---|---|
| `core` | `normalize(capture, { profile })` | `NormalizeOptions` has no profile; it arrives with the capture |
| `core` | `attributeRegions(regions, snapshot)` | three parameters — the third carries `scale`, which is required and has no default |
| `dom` | `collect(container, { subject, profile })` | `viewport` and `engine` are required; `profile` is an `ObservationProfile`, and is detected |
| `react` | `collect(container, { subject, profile: 'jsdom' })` | the same |
| `playwright`, `remote` | `createPlaywrightRenderer({ viewport })` | the viewport arrives with each document, so one renderer serves several |
| `storybook` | `toSubjects(index, { exclude })` | `excludeTags` |
| `storybook` | `subject.storyId` | `subject.story.id` |
| `history` | `churn(component)` | `churn(component, window)` |
| `session` | `createSession({ document, profile })`, `verify()` | `{ document, viewport, engine }`, and `verify` takes the replay back |
| `cli` | `run(config, options)` | `run(options)`, and `deps` is required |
| `report`, `png`, `raster` | imported names the example never used | — |

Every one of those changes was deliberate, and every one was safe to make: the
compiler found each call site and the author fixed it. That is exactly the
point. **The examples were the only call sites the compiler could not see, so
they were the only ones nobody updated.**

This is not a documentation-discipline problem and cannot be fixed by being more
careful. A reviewer reading a README diff has no way to know that
`createPlaywrightRenderer` stopped taking a viewport six commits ago in another
package. The compiler knew. It was not asked.

The damage lands where it is least recoverable. Prose that is wrong makes a
reader doubt a sentence; an *example* that is wrong is copied into their editor,
and the first thing that happens is a type error in their project, about our
API, on their first ten minutes with the tool.

## Decision

**A fenced `ts` example in a README is source code, and is compiled against the
package's published types on every run of the checks.**

`tools/documentation.test.ts` extracts each fence, compiles it as a virtual
module sitting beside the README it came from — so `@variance-authority/observe`
resolves through the package's own `exports` to its built `.d.ts`, exactly as it
would for a consumer — and reports each diagnostic against the markdown line a
person would edit. It also fails an example that imports a name it never uses,
which is what a broken example looks like after somebody edited the code around
it and left the imports.

A snippet is not a program: it names things it never declares. Those names are
supplied by a context map, under one rule that is the reason this holds up —
**a name is typed from the signature that consumes it**, never from a type
written in the checker. `viewport` is spelled
`Parameters<typeof createHarness>[0]['viewport']`. Nothing in the checker can
drift from the API, because nothing in it restates the API; and a plausible
invention like `sourceIndex` fails to resolve rather than being quietly re-typed
to keep the suite green. A context entry that no example uses is itself a
failure, so the map cannot rot the way the documentation did.

The same file checks the claims around the examples, for the same reason: every
link and `#anchor`, every backticked repository path, and every `file:line`
reference across all markdown. Prose does not rot at random. It rots wherever it
names something the compiler also names.

**The check runs in `yarn typecheck` as well as `yarn test`**, because a
developer asking "does this still compile" is asking about the examples too, and
an answer that silently excludes the most-copied code in the repository is the
wrong answer.

## The same rule, applied to the other two things a reader copies

An example is not the only call site in a README. A command line and a config
file are copied just as literally, and both were wrong for the same reason.

**A config is parsed by the parser that would reject it.** The documented
`variance.config.json` was not a valid config: `subjects.collector` is required
and the example omitted it, as did the sentence under it describing the shape.
A reader who copied it got an operator error on their first run. The check feeds
each `jsonc` fence whose leading comment names `variance.config.json` to
`parseConfig` itself — not to a restatement of its schema, which would be a
second thing to keep in step.

**A flag reaches the README along a chain, checked at each link.**
`PER_COMMAND` in `bin.ts` decides what a command accepts; `bin.test.ts` asserts
that `USAGE` names every flag in it, reading the accepted set out of the
parser's own refusal message rather than out of a copy; and
`documentation.test.ts` asserts the README shows `USAGE` line for line. A
renamed flag now fails two tests on its way to the documentation instead of
arriving there never. The synopsis a reader retypes is the one the parser prints
back at them when they get it wrong, because it is the same string.

## What this does not cover, and why

**A fence in a spec or an ADR is not compiled**, and is name-checked instead. It
is a *proposal* about code that may not exist — a spec survives only while its
capability is unfinished, so an interface in one describes the thing the spec
exists to argue for. Demanding those compile would invert what a spec is.

But a proposal does not only propose. It also *borrows*: `Digest`, `ProfileId`,
`SemanticSnapshot` are the repository's, quoted so the proposal has something to
attach to. Those are checkable, and the mechanism needs no status field and no
allowlist — **a proposal declares what it proposes and references what already
exists**, so subtracting the declarations *is* the not-built exemption. Eleven
repository types are borrowed across the seven such fences; all eleven exist.

An earlier revision of this paragraph said "specs 0001 and 0002 are marked `not
built`" and listed ten of those types. Both were wrong — 0002 is `built, not
wired`, 0001 turned out to be too, and `Window` was the one omitted — which is
the argument for checking rather than for a more careful hand-count.

### Comparing members was tried and rejected, which is the more useful record

The obvious stronger check is: when a fence declares a type the repository also
exports, compare their members. It looks compelling, and on this repository it
fires three times — and two of the three are wrong.

| fence | says | ships | verdict |
|---|---|---|---|
| ADR-0002 `ObservationProfile` | `id: 'jsdom' \| 'chromium'` | `id: ProfileId` | **same type.** `ProfileId` is that union |
| spec 0002 `Observation` | `band: 'structure' \| 'style' \| 'geometry'` | `band: Band` | **same type**, same way |
| spec 0002 `HistoryStore` | `record(observations, tokens)`, bare `Promise<T>` | `record(run, observations, tokens)`, `Promise<Answer<T>>` | **real drift**, and deliberate |

Two of three are alias substitution — a union spelled out in the proposal and
named in the code. Telling that apart from a genuine change requires resolving
type aliases, which requires a type checker, which is the compile this decision
rejected two paragraphs ago. A check whose first run is two false alarms and one
finding is a check that gets an exemption added rather than a fix, and then gets
deleted.

So the third row was fixed by hand instead — spec 0002's contract had described
neither the draft's intent nor the shipped interface, and the code had been right
since it was written — and this is recorded here so the next person to have the
idea finds the measurement rather than the intuition.

**What the name check therefore buys, stated narrowly:** a type renamed to
*nothing* is caught. A type renamed to something else is not. A member that
changed shape is not. Of the eleven documentation defects tabulated above, this
check would have caught **none** — they were signature and property changes in
compiled examples, which is what the compile gate is for. It covers a different
surface, not a stronger one.

**A number is not checked.** "1007 CSS rules → 1", "7.5 ms warm vs 205 ms cold",
every pixel count in `cases/` — these are measurements, and the file that
produced each one is cited beside it. Nothing re-derives them, and the residual
risk is stated in the checkpoint rather than hidden here.

## Consequences

- An example may be longer than it was. `cli`'s grew from eight lines to
  twenty-four, because `run` genuinely requires a `deps` object and the old
  example's brevity was purchased by being wrong. The seam the surrounding
  paragraph claims is now visible in the code rather than asserted next to it.
- An example that genuinely cannot compile has to say so in TypeScript. The
  `server` README's "you implement this" backend is `declare const backend:
  HistoryBackend`, which is both honest and checkable, rather than `{ /* … */ }`,
  which is neither.
- Adding a package means adding its README example to the same gate, at no cost:
  the checker discovers fences from `git ls-files`, so nothing has to be
  registered.
- The checks require a build first, exactly as `tools/boundaries.test.ts` does.
  They compile against `dist`, because that is what a consumer imports.
