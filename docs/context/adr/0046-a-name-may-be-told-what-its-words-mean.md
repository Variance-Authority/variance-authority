# ADR-0046 — A name may be told what its words mean

**Status:** accepted
**Date:** 2026-08-23
**Relates to:** ADR-0045 (a subject may be a variation of another subject),
ADR-0002 (absent is not empty), spec 0033 (two sides a person chose)

## Context

ADR-0045 reads a subject's name with no help at all: a subject's parent is the
longest other subject in the run whose id it extends at a separator. That rule
needs nothing written down, which is its whole value — a suite that already
names its axes gets variations without editing anything.

It is also the only reading available, and it can only walk *outwards*. A parent
has to be a shorter name the child extends, and three ordinary suites are not
shaped like that:

- **The baseline is spelled out.** Storybook's is, almost always:
  `checkout--default` and `checkout--empty`, with no `checkout` anywhere. Neither
  name extends the other, so nothing is compared, and the suite whose convention
  is the most disciplined gets the least out of it.
- **An axis has a vocabulary.** `ff-on` and `ff-off` are one axis at two values.
  Read as characters, `ff-on` is `ff` plus `on`, and `on` is a word that appears
  inside other words.
- **The question is between two names of the same length.** *What is the
  difference between the green one and the glass one* is the question a person
  actually asks, and neither name is a prefix of the other, so the rule sees two
  unrelated subjects.

The available answers were both bad. Asking adopters to rename their subjects to
suit the tool is asking a suite to change its convention for a reading — the
opposite of the position ADR-0045 took. Asking for a `variance-parent:` tag on
each of them is a declaration that repeats what the name already says, per
subject, forever, and the tag exists for names that *cannot* carry the link.

What is missing is not a link. It is that nobody has said what the words in the
names mean.

## Decision

**A repository may declare the format its subject names are written in, once,
and every name in the run is read through it.**

```json
{
  "names": {
    "axes": [
      { "axis": "state", "values": ["default", "empty", "new-flow"] },
      { "axis": "colour", "values": ["green", "glass"] },
      { "axis": "flag", "values": ["ff-off", "ff-on"] }
    ]
  }
}
```

### A grammar, and not a function

The obvious shape is a function — the adopter writes `deconstruct(id)` and
returns the axes. It is refused for the reason the config is JSON at all — the
position `packages/cli/src/config.ts` holds, and which no ADR had occasion to
write down until now: a `.js` config means executing code found on disk to decide
what to observe, which puts the configuration inside the thing being tested.

The refusal costs less than it looks, because a function is the weaker artefact
here anyway. A function maps a name to its axes and cannot be asked the question
this feature is *for*: which **other** name sits one step away along one axis.
Answering that from a function means enumerating every subject in the run and
inverting its output by hand. A vocabulary answers it directly, and it is
reviewable — a reader can see which words are axes, which axis is last, and
therefore which pairs this run will compare, without running anything.

### The order is the declaration, and the first value is the base

Axes are listed in the order the names write them: ADR-0045's great green dragon
rule, moved from a convention held in the author's head to a line in the config a
reader can check. Values are a closed list rather than a pattern, so a value
containing the separator is one word, and the longest matching value wins.

**`values[0]` is the base, and a name carrying it means what a name omitting it
means.** That single rule is what unifies the spelled baseline with the implied
one: `checkout--default` and `checkout` are one coordinate, so a suite that says
its baseline out loud reads exactly as one that leaves it silent. It is also what
gives an axis a direction — without a base, `green` and `glass` are two words
with no reason for either to be the thing the other is measured against.

### The link is one step toward the base

A subject's parent is its own name with its **last** axis moved one step toward
that axis's base, resolved to the nearest coordinate the run actually planned:
`checkout--glass-ff-on` → `checkout--glass` → `checkout--green` →
`checkout--default`. The last axis only, so a link is one axis and the difference
across it is worth reading — unchanged from ADR-0045. Toward the base, so the
chain has a direction and the pair does not depend on which of the two was asked.

The step is carried on the link, so the record says which axis was crossed and
what it was crossed between. This is the part a bare pair of ids could never
report: not *these two differ* but *`colour` is `glass` here and `green` there,
and every other axis is the same word in both*.

### A grammar replaces the unconfigured rule rather than backing it up

A name the grammar finds nothing in gets no parent. Falling through to longest
prefix would answer a configured question with an unconfigured guess and print
the two in the same voice, which is the failure writing a format down exists to
prevent.

Ambiguity is refused on ADR-0045's terms. Two subjects at one coordinate is a run
where a name means two subjects, and the run says so rather than picking the
first. So are the grammars that cannot mean anything: a value belonging to two
axes, an axis with a single value, an axis named twice — all refused when the
config is read, by name.

## Consequences

**There is a config key now.** ADR-0045's consequences said there was no command,
no config key and no flag, because the declaration lived on the subject. That
still holds for the *link*: `names` declares nothing about any pair. It says what
the words in this repository's names mean, once, in the file where every other
run-wide reading is written down.

**A Storybook suite gets variations it could not get before.** `--default` is the
common baseline spelling, and until now it was the spelling the inference could
not see. Nothing about the stories changes.

**The suite's convention becomes reviewable.** ADR-0045's known danger is that
breaking the adjective order errors nowhere. A grammar does not fix that — a name
written out of order still reads as a different coordinate — but the intended
order is now a line in a config file that a reviewer can compare a new subject
against, instead of a habit.

**Its failure mode is silence, not a wrong pair.** A grammar that is missing an
axis, or whose values are misspelled, finds nothing in the names that carry them
and links nothing. That is the right direction to fail in: an unmeasured
variation is the state this project was in before ADR-0045, and a *wrongly*
measured one is a difference attached to the wrong subject and printed with full
confidence.

**Nothing about it reaches identity.** The grammar is read at plan time and used
at comparison time. No hash, no baseline, no store, and a run whose only news is
a variation is still a green run.

**It does not answer spec 0033.** Two subjects still have to be comparable
*before* the run, and a run still keeps no addressable capture to point at
afterwards. What moved is the reach of the same-run half: the pair no longer has
to be one name extending another.
