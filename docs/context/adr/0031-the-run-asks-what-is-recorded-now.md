# ADR-0031 — the run asks what is recorded now, in one read that never truncates

**Status:** accepted
**Date:** 2026-08-10
**Extends:** ADR-0018 (a component's hash covers its own nodes)
**Relates to:** [spec 0002](../../specs/0002-history-store.md)

## Context

`@variance-authority/history` and `@variance-authority/server` have shipped for a
cycle with nothing crossing the wire between them. The reason was not effort. The
contract had four reads — `lastChanged`, `churn`, `valueJourney`, `reach` — and
every one of them is a question a **person or an agent asks about the past**.

The write path asks a different question, about the present. The rule that makes
the whole design affordable is *a row is written only when a hash moves*, so that
a 300-subject run in which two components changed writes two rows. Implementing
it needs the rows currently recorded for the subjects about to be written, and
`observationsFrom(hashes, run, previous)` takes exactly that argument. Nothing
could produce it. The closest read, `lastChanged`, returns one row — computing
`previous` through it is one request per component per band, which for 300
subjects at ten components each is 9,000 round trips per run.

So the write rule was specified and given nobody the means to implement it, and
the consequence was code on both sides of a hop with no caller on either.

## Decision

**A bulk read of the present, `current(subjects)`, returning the latest row per
`(subject, component, band, profile)` and nothing older.**

It is a `POST` despite changing nothing, because its argument is a subject list
and three hundred subject ids do not fit in a query string that every proxy
between a CI job and the service will forward.

**It never truncates and takes no `limit`, and that is the load-bearing half.**
Every other read in this contract caps and reports what it left out, because a
partial answer to a question about the past is a lower bound whose reader can be
told so. A partial answer here is different in kind: a missing previous row is
indistinguishable from a hash that was never recorded, so the run writes a change
that **did not happen** — into an append-only store, inflating every rate
computed over that window from then on, with nothing anywhere to contradict it.

What is bounded instead is the *question*. `MAX_CURRENT_SUBJECTS` is 200, the
client splits a longer subject list across requests and concatenates, and the
service refuses an over-long list with a 400 that names the cap rather than
answering the first 200 and looking successful. The answers are disjoint by
subject, so concatenation is arithmetic-free.

The answer is not bounded by the age of the project — it is one row per live
scope in the subjects asked for — so it does not breach the rule that nothing
here loads a whole history.

## Consequences

**The write rule is implementable, so there can be a caller.** That is the whole
purpose; everything spec 0002 promised was unreachable without it.

**Newest wins when folding `previous`, decided on the instant rather than on
arrival order.** `structure` is scoped without a profile (it is the portable
band), so a project running two tiers gets two rows that land on one key. If the
older one won, the run would record a change back to a hash the project has
already moved away from. `observationsFrom` now compares `at` and keeps the
newest; the backends sort by `(at_ms DESC, rowid DESC)` so that two rows sharing
an instant — one clock read, two profiles — resolve to the later write.

**Both backends grow one primitive**, `currentOf`, implemented with a window
function in each: `ROW_NUMBER() OVER (PARTITION BY project, subject, component,
band, profile ORDER BY at_ms DESC, rowid DESC)`. Rows come back raw rather than
reduced, because the fold rule — structure compares across profiles, style and
geometry do not — belongs next to the write it governs, and a backend that
reduced them would be a second implementation of it.

**One more request per run.** For a 300-subject suite that is two round trips
(200 + 100) before the write, against the 9,000 the existing contract implied.

## Alternatives

**The server deduplicates on write.** The run sends everything it observed and
the service drops rows equal to the latest stored. No new read, and the
comparison happens where the data already is. Rejected because the request body
then carries every component of every subject on **every** run — thousands of
rows where the design promised two — and `maxBodyBytes` exists precisely to
refuse bodies that size. It also moves the scope rule into the backend, where the
second engine gets to reimplement it.

**Cap `current` like every other read and report the omission.** Rejected above:
the omission cannot be reported to anyone who could act on it, because the
consequence is not a short answer, it is a wrong permanent row. A cap here trades
a loud refusal for a silent corruption.

**Derive `previous` from a local cache written by the last run.** It works until
two branches, two machines, or a fresh CI container — which is the whole reason
the record is a service rather than a file (spec 0002). A cache miss looks
exactly like a first observation, and a first observation writes every row.
