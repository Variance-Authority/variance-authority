# ADR-0030 — two second passes, one variable each

**Status:** accepted
**Date:** 2026-08-06
**Extends:** ADR-0009 (sessions detect instead of rinse), ADR-0029 (a page is held still before it is read)
**Relates to:** [spec 0012](../../specs/0012-order-dependence-in-a-run.md)

## Context

A run that calls a subject `changed` is making a claim about a component, and
there are three ways for that claim to be wrong. The pixels moved because an
earlier subject left state behind; the pixels moved because the page does not
render the same thing twice; or the pixels really did move because somebody
edited something. All three arrive at the report identically, as *the pixels
moved*, and they need three different people to do three different things.

ADR-0009 bought a large saving by not rebuilding the world between subjects, and
[`alone.ts`](../../../packages/cli/src/commands/alone.ts) is the counterweight it
was bought with: re-collect a changed subject in a clean world, and if the
difference is gone, the session moved it. That closed the first of the three.

The second stayed open, and worse than open — it was being *answered wrongly*.
A subject with a clock in it differs from its baseline in a clean world exactly
as loudly as it differs in company, so the clean-world pass returns "the change
is still there with nothing else in the world, so it is the component". That
sentence is a confident, attributed, false claim about a component nobody
edited, and it is the failure ADR-0029 named: attribution makes a false alarm
credible.

[`flakiness.md`](../../flakiness.md) had already committed to the position — *an
unstable hash is a finding with a cause, not noise to suppress* — while shipping
nothing that could find one.

## Decision

**Two second passes, each varying exactly one thing, and the order between them
is part of the decision.**

| | world | time | answers |
|---|---|---|---|
| `again` | held | advanced | does this subject move on its own? |
| `alone` | rebuilt | same | did some *other* subject move this one? |

`again` re-collects the subject immediately, in the same world, and compares the
two documents by digest. Disagreement is reported as `unstable`, with the
components and frequency bands that moved.

**`again` runs first, and when it finds something `alone` is not asked.** Not an
optimization — `alone`'s whole inference is *the clean reading differs from the
shared one, therefore the world moved it*, and that is only evidence if two
readings of one world would have agreed. Run the other way round, a subject with
a clock produces a confident sentence about suite pollution and sends somebody to
bisect a run order that has nothing to do with it.

Neither is a retry. Both outcomes of both passes are reported and neither clears
anything.

## Consequences

**It costs a collection and never a paint.** A `RenderDocument` is a complete
statement of what is to be painted, so two documents with equal digests cannot
paint differently — the argument `settle` already makes against a baseline, made
here between two readings seconds apart. The check runs only on subjects the run
already called `changed`, inside the same `alone.limit` budget, so a green run
pays nothing and an investigated subject spends one either way.

**`accept` refuses an unstable subject**, for the reason it refuses order
dependence: the image on disk is one of two readings, chosen by a race, and
promoting it makes the coin flip the thing every later run is measured against.

**Absence is not a stability certificate, and the report says so.** A subject
that reads differently one time in fifty passes twice-in-a-row forty-nine runs
out of fifty. Two readings put a floor under flakiness; nothing here puts a
ceiling on it. Recurrence over a window — the shape Argos ships — is a different
instrument and belongs to [spec 0002](../../specs/0002-history-store.md), which
is still blocked on its own contract decision.

**Raster-level nondeterminism is invisible to it**, for the same reason it is
cheap: it does not move a document digest. That is the environment key's
territory, not this one's.

## What it found on its first contact with a real page

All five changed stories in
[`cases/storybook-case`](../../../cases/storybook-case), and the cause was ours.

Blink does not write a mutated inline style back into the `style` attribute
eagerly — `element.style.padding = …` marks the declaration dirty and the
attribute is regenerated the next time anything reads the element's attributes.
`outerHTML` is such a read, and the regenerated attribute is appended. So a
freshly mounted component held `[type]` with a pending style, our path stamp
appended `[type, data-va-path]`, and serialization materialized the style at the
end. Collect the same story again with no remount and the style attribute already
existed, so the stamp went last.

Same tree, same pixels, two document digests — decided by whether the subject had
been read before in that run.

The verdict was never wrong, which is why nothing had ever reported it. What was
wrong was the economy: `settle` skips a render when this run's document digest
equals the digest the baseline was painted from, so the cheap tier was switching
itself off depending on the collection history of the run that recorded the
baseline. A silent, permanent, invisible cost.

The fix is in
[`document.ts`](../../../packages/dom/src/document.ts): read the attribute names
before stamping, so anything pending is materialized while our own attribute is
still absent. Seven of the eight stories now produce one digest for two
consecutive readings; the eighth is the one with a clock in it, which is the
answer.

## Alternatives

**Fold instability into the verdict.** Rejected on the same ground ADR-0026
rejected folding `ignored` into `unchanged`: `changed` is true — the pixels
really did move — and a word that replaced it would lose that. It is carried as a
field and rendered as a label, exactly as order dependence is.

**Read every subject twice, always.** It finds latent instability on subjects
that happened to agree with their baseline this run, which is real value — and it
doubles the collection cost of every green run, which is the cost this project
exists to not pay. So it is a *mode*, `variance run --flakes`, rather than the
default: the per-run rule spends only on subjects somebody was going to review
anyway, and the sweep is the nightly job that answers *which of these would flake
tomorrow*. The sweep ignores `alone.limit` — an operator who asked about the
suite must not be handed the first twenty subjects under a whole-suite heading —
and an unstable subject exits `1` even when every verdict is green, because a
sweep that found six and exited `0` told CI nothing it could act on.

**Suppress a recurring difference automatically**, once its shape has appeared
often enough. That is the shipped answer elsewhere and it works at a scale
nothing here has run at. It is declined for the reason `flakiness.md` gives:
auto-ignoring by diff shape silences the symptom without naming the writer, and
the same suppression that hides a flake hides the regression that later lands in
the same region.
