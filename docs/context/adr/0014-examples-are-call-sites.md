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

**A fence in a spec or an ADR is not compiled.** It is a *proposal* about code
that may not exist: specs 0001 and 0002 are marked `not built`, and their
interfaces describe the thing the spec exists to argue for. Demanding they
compile would invert what a spec is. The cost is real — a spec can name a type
that was renamed under it and nothing will say so. Checked by hand on
2026-08-03: every type named in those fences (`Digest`, `SemanticSnapshot`,
`ProfileId`, `ProfileExpectation`, `Undecidable`, `Band`, `Observation`,
`Churn`, `TokenValue`, `Reach`) still exists under that name.

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
