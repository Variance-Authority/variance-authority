# ADR-0017 — The exit code is the interface, and the inputs are a file

**Status:** accepted
**Date:** 2026-08-03
**Extends:** ADR-0002 (observation profiles), ADR-0012 (observability and the damage boundary)
**Discharges:** the command-line interface spec

## Context

Everything this project does was reachable only by writing a test file that
called the packages directly. That is fine for the people who wrote the packages
and useless for a pre-commit hook, a CI job, or anyone deciding whether to try
it. A command line was needed.

The question a command line settles is not which flags to have. It is **how the
thing that runs it learns what happened.** CI has exactly one channel it reads
without being taught: the process exit status. Everything else — stdout, a JSON
file, an annotation — is something an operator has to wire up, and a tool whose
verdict requires wiring gets wired wrong once and then trusted.

The failure that follows is specific. A red build meaning *either* "a component
changed" *or* "the store was unreachable" is a red build nobody investigates,
because the two demand opposite responses and the reader cannot tell which they
have. Worse, the second is the case where continuing is destructive: an
unreachable baseline store reported as a changed subject leads to an `accept`
that overwrites the baseline the run existed to compare against.

## Decision

**Three exit codes, and a verdict and a crash never share one.**

```
0  nothing needs review
1  changes need review
2  operator error — the run did not happen
```

`1` is an answer about the product. `2` is a statement about the machine: a bad
config, a missing browser, a store that would not answer. Nothing that failed to
observe may exit `1`, and nothing that observed successfully may exit `2`.

**Every skip is stated.** A subject that was not observed is listed with its
reason. Silence about a subject is indistinguishable from a pass, which is the
failure the whole system exists to avoid, so a coverage list that is *absent*
means nobody looked and a coverage list that is *empty* means everything was
observed — the same rule as ADR-0015's `findings`.

**Configuration is a file the operator writes.** Nothing is inferred from the
network and nothing is downloaded at run time. A tool that fetches its own
behaviour cannot be pinned, cannot be audited, and answers differently on a
machine with no egress — and this project's storage, renderer and policy choices
all change verdicts.

**`doctor` never guesses.** It reports what it observed, including that the font
probe reads metric-compatible substitutes as missing. A diagnostic that rounds an
uncertainty to a verdict is worse than no diagnostic, because it is consulted
precisely when something is already wrong.

**Everything the binary does is exported as an ordinary function.** A CLI whose
logic is reachable only by spawning a process can be tested only by spawning one,
and the half of a run you want to mount in a test is never the half a process
gives you.

## Consequences

**A missing browser is testable without uninstalling a browser.** `run --profile
chromium` on a machine with no Chromium must exit `2`, and that was argued in a
comment and asserted by nothing until 2026-08-03, because it cannot be reached
through `main` on a developer machine that has one. The renderer opener therefore
takes the thing that might fail as an argument — a seam that exists for no reason
except that the rule above has to be a red test rather than a paragraph.

**The CI action parses nothing.** The GitHub composite action passes the exit
code through and renders its comment with the same binary, so the docket on a
pull request and the output of `report` cannot describe one run differently. An
earlier version reached into the CLI's `dist/` layout to import the renderer,
coupling the action to a build path that is not a published contract.

**`accept --all` is the standing hazard, and it is named where it is used.** In
that mode the gate becomes a recorder: the regression the check found is promoted
to the baseline by the same run that found it, and the next run is green. It is
why baseline commit-back ships off by default, and why the CLI README says to
name subjects explicitly anywhere the difference matters.

**Exit `2` covers a wide range and does not distinguish inside it.** A malformed
config and an unreachable store are one code. That is deliberate — the
distinction a caller acts on is *did the run happen* — and it means the message,
not the code, is what tells an operator which of the two they have.
