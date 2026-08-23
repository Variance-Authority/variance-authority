# ADR-0045 — A subject may be a variation of another subject

**Status:** accepted
**Date:** 2026-08-22
**Relates to:** ADR-0002 (absent is not empty), ADR-0018 (a component's hash is
its own code), spec 0032 (a render nobody committed), spec 0033 (two sides a
person chose)

## Context

Every comparison this tool makes is between two revisions of one subject. That
is what makes a verdict possible — `diffSnapshots` refuses two different
subjects, and refuses correctly, because *changed* is a claim about a thing over
time and two different things have no shared history to have changed against.

The refusal leaves a category of difference unmeasured, and it is not a rare
one. A feature flag's second arm, a story at a narrow viewport, the same page in
the dark scheme, a fixture that answers with the empty state: each arrives as a
new subject. A new subject is `new` — one baseline written, an empty diff,
nothing said — and every run after that compares it only to itself. The
difference the arm exists *for* is the one difference nothing in the suite has
ever measured, and the only way to see it is to open two pictures side by side
and use your eyes.

The obvious fix is a vocabulary: a `variants` block listing viewports, schemes,
flags and backend scenarios, expanded into subjects by the tool. It is wrong
twice. Every collector expresses these differently and only the collector can
produce them — a story sets args, a route sets a query, a Playwright fixture
sets a cookie or routes a request — so the tool would be reimplementing each
collector's own mechanism behind a second, worse one. And the list is open, so
the vocabulary is a thing this project extends forever while every adopter with
an axis nobody thought of waits their turn.

## Decision

**A subject may declare which subject it is a variation of, and the difference
between the two is computed and reported. Nothing declares what kind of
variation it is.**

The three parts of that are each load-bearing.

### The link is a tag, not a config entry and not part of identity

The declaration is `variance-parent:<id>` on the subject's tags. Tags are the
one per-subject declaration every collector here already carries: Storybook's
built index exposes a story's `tags` and not its `parameters`, and a
hand-written collector sets whatever it likes on a planned subject.

Not a field on `SubjectRef`. A subject's identity is what its baseline is stored
under, and adding a field to it is a mass-invalidation event for a link that
changes no pixel. The parent is read at plan time and used at comparison time;
nothing about it reaches a hash, a store, or a baseline lineage.

Not a central list of pairs, either. That is a second file to keep in step with
every story rename, and the rename is the common event.

An id may be given in full, or as a suffix after the namespace — a story
declaring its parent inside Storybook knows the story id and not the prefix this
tool puts in front of it. A suffix matching more than one subject is refused
with a sentence rather than resolved by plan order: attaching a difference to
the wrong parent and printing it with full confidence is worse than printing
nothing.

### A name that already says it is a declaration

Suites encode their axes in names already: `checkout`, `checkout-dark`,
`checkout-dark-narrow`. Requiring a tag beside a name that says the same thing
is a second place to keep in step with the first, so a subject with no tag is
asked its own name, and its parent is the longest other subject in the run whose
id it extends at a separator.

This is the *great green dragon* rule, and it is worth naming because it is a
constraint on the author rather than on the tool. English fixes adjective order:
a great green dragon cannot be called a green great dragon, so one dragon has one
name. Fix the axis order the same way and every name has exactly one parent,
found by dropping what was added last — the chain is derivable and nothing is
declared.

Break the order and nothing errors, which is the danger. `checkout-dark-narrow`
and `checkout-narrow-dark` are one render under two names: two baselines, two
chains, and each reporting a two-axis difference where a one-axis difference was
meant. The duplication is already observable — two subjects with one rendering is
a shared rendering, which composition reports — but it surfaces as an echo rather
than as the naming mistake it is.

Longest prefix wins, so `checkout-dark-narrow` varies `checkout-dark` rather than
`checkout`. Each link is then one axis, which is the only reason the difference
across it is worth reading. A boundary character is required, so `checkout` is
not the parent of `checkouts`.

**A tag is never overridden by a name, and a name never answers for a tag that
failed.** A written declaration that resolved to nothing is a mistake to report;
substituting an inference would hide it behind an answer shaped like the one that
was asked for. And the record carries which route was taken, because *somebody
said so* and *a name implied it* are not the same evidence, and every sentence
built from the record inherits the difference.

### The difference is computed, never named

`deriveVariation` runs the same tree comparison a verdict runs — the arithmetic
is shared with `diffSnapshots` through `compareTrees` rather than reimplemented,
because two implementations of a diff is two answers to one question — and
reports the bands that moved, the components the movement was attributed to, and
a digest over the deltas.

The digest is the point. It is stable while parent and variation move together,
so a token edit that turns both subjects red leaves the difference between them
unchanged, and a reviewer who has already approved *what the flag does* can be
told that it still does that. It moves when the variation gains or loses
something its parent does not have, which is the event nobody currently has a
name for: **the flag now does something else**.

### A variation is never a verdict

Nothing here reaches the exit code, `accept`, or the baseline store. A dark
story is darker than its light parent, and a run that went red over it would be
reporting a subject for existing. What a variation changes is a *review*: it
turns a second baseline nobody can ask a question about into a difference
somebody can read.

An unresolvable or unobserved link is reported rather than dropped, on ADR-0002's
terms. A parent that failed to render is a variation that was not measured, and
a section that quietly omitted it would render a broken link as a subject with
nothing to say.

## Consequences

**A suite that already names its variants gets this without editing anything.**
Which is also the risk: the inference is exactly as good as the convention, so
each inferred pair says in its own sentence that nobody declared it. The caveat
is on the record and not in a heading, because a record is read one at a time.

**The axes stay the collector's business.** Viewport, colour scheme, backend
scenario and feature flag are all one mechanism here, because the only thing
this tool knows about any of them is that two subjects were declared related. An
adopter with a fifth axis needs nothing from this project.

**A run holds two trees, not three hundred.** The subjects that are somebody's
parent are known before collection starts, so the loop retains those snapshots
and no others.

**Reading it is an MCP question first.** `variance_variations` answers it, and
the text report prints the same answer when a run has one — there is no separate
formatter, for the reason `report.ts` already gives. There is no command, no
config key and no flag: the declaration is on the subject, which is where the
collector already is.

**It does not answer spec 0033.** *What is the difference between run 1 and run
121* is still unreachable, because a run keeps no addressable capture to point
at. What this lands is the same-run half: two subjects of one run, compared
because somebody said they were related.

**It does not answer spec 0032 either.** A declared arm can now be measured
against the arm it varies; what still has no record is which arm a render was
*produced under*. A percentage rollout assigns per browser context, so two arms
still share one baseline they disagree about, and `again` still reports that as
an unstable component. The link makes a *declared* variation legible; the
assignment problem is untouched.

## Amended 2026-08-23 — there is a config key after all

The consequence above says "there is no command, no config key and no flag: the
declaration is on the subject". That is still true of the *link* and is no longer
true of the *reading*. [ADR-0046](0046-a-name-may-be-told-what-its-words-mean.md)
adds `names`, which declares what the words in this repository's subject ids mean
— once, run-wide, saying nothing about any pair — because the longest-prefix rule
above can only walk outwards and therefore cannot see a spelled baseline, an axis
with a vocabulary, or two names of the same length.
