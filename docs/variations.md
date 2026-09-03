# Subjects that are other subjects on purpose

A feature flag's second arm, the same page in the dark scheme, a story at a
narrow viewport, a route whose backend answers with the empty state. Each of
these is an ordinary subject here, with its own baseline, and every run compares
it only to itself.

That means the difference the arm exists **for** is the one difference nothing
measures. A story added behind `checkout-v2` is `new` on its first run: one
baseline written, an empty diff, nothing said. From then on it is green until
somebody edits it. What the flag *does to the page* is visible by opening two
pictures and using your eyes, and is recorded nowhere.

**A subject is compared to the subject it is a variation of.** The two are read
in the same run, and the difference between them is reported with an identity of
its own. Which subject that is, this tool would rather work out than be told.

## The name already says it: the great green dragon

Most suites have already written the link down. `checkout`, `checkout-dark`,
`checkout-dark-narrow` — the name carries the axes, in order, and a declaration
beside it would only repeat what the name says and then drift from it.

So a subject is asked its own name first. Its parent is the longest other
subject in the run whose id this one **extends at a separator**:
`checkout-dark-narrow` varies `checkout-dark`, which varies `checkout`. Longest
wins, so each link is one axis, which is the only reason the difference across it
is worth reading. A separator is required, so `checkout` is not the parent of
`checkouts`.

This works exactly as well as your names do, and the constraint has a name.
English will not let you say *green great dragon*: adjective order is fixed, so
one dragon has one name. Fix your axis order the same way — scheme before
viewport before flag, or whatever order you like, as long as it is the same one
every time — and every subject has exactly one name and exactly one parent, found
by dropping what was added last.

Break the order and nothing errors, which is the thing to watch for.
`checkout-dark-narrow` and `checkout-narrow-dark` are one render under two names:
two baselines, two chains, and each reporting a two-axis difference where a
one-axis difference was meant. It shows up as two subjects with one rendering in
[`composition.md`](composition.md), which is a true report of the wrong problem.

## Telling it what the words mean

That rule reads a name with no help, so it can only walk outwards: a parent has
to be a shorter name this one extends. Plenty of suites are not shaped like that.
The baseline is spelled out — `checkout--default`, not `checkout` — the axes have
vocabularies, and the question worth asking is between two names of the same
length: what is the difference between the green one and the glass one. Neither
of those extends the other, so the rule above sees two unrelated subjects.

`names` says what the words are:

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

Axes in the order your names write them — the same fixed adjective order as
above, now somewhere a reader can check it. Values are a closed list rather than
a pattern, so `ff-on` is one word and not `ff` plus `on`, and so a name can be
walked *toward* its base: **the first value is the base**, and a name carrying it
means what a name omitting it means. That is what makes `checkout--default` the
subject `checkout--empty` is measured against, and it is how a suite that spells
its baseline out loud reads the same as one that leaves it implied.

A parent is then this subject's own name with its last axis moved one step toward
the base — the nearest coordinate the run actually planned:

```text
story:checkout--glass-ff-on  →  story:checkout--glass
story:checkout--glass        →  story:checkout--green
story:checkout--green        →  story:checkout--default
```

One axis per link, still, and now the link knows which axis it was:

```text
Nothing declared this pair. The configured name format reads the two as one
subject at two coordinates: `colour` is `glass` here and `green` there, and
every other axis is the same word in both — so what is measured above is that
axis and nothing else.
```

A grammar **replaces** the unconfigured rule rather than backing it up. A name it
finds nothing in gets no parent, because falling through to longest-prefix would
answer a configured question with an unconfigured guess and print the two the
same way. Two subjects sitting at one coordinate are refused by name rather than
resolved by order, as an ambiguous tag is.

It is a grammar and not a function you write. The config is JSON and stays JSON —
a `.js` config means executing code found on disk in order to decide what to
observe — and the trade is smaller than it looks: a function mapping a name to
its axes could not be asked which *other* name sits one step away, and that is
the half this needed.

## Declaring it, where a name will not carry it

A name carries an axis somebody chose to spell out. When there is no such name —
an id from a route list, a subject whose parent lives under another namespace, a
convention this suite is not going to change — the link is stated outright, with
one tag on the subject that is the variation:

```text
variance-parent:<subject id>
```

Tags rather than a configuration block, because there is no way to express a
variation that works for more than one collector: a story sets args, a route
sets a query, a Playwright fixture sets a cookie or routes a request. Whatever
produces the variation is the collector's business and stays there. The only
thing this tool needs is the *link*, and every collector here already carries
tags.

In Storybook that is the story's own `tags` array:

```text
export const FlaggedCheckout = {
  tags: ['variance-parent:checkout--default'],
};
```

The id may be written in full — `story:components-button--primary` — or as the
part after the namespace, which is what a story knows about itself. A short form
matching more than one subject in the run is refused by name rather than
resolved by order: a difference attached to the wrong parent, printed with full
confidence, is worse than one not printed at all.

Nothing else changes. The tag is read when the run is planned and used when the
two are compared; it reaches no hash, no baseline and no store, so adding one
invalidates nothing.

**A tag always wins, and a name never covers for a tag that failed.** A
`variance-parent:` that resolved to nothing is reported as the mistake it is,
rather than quietly answered with a guess. And a link read off a name says so —
in the record, in the sentence, and in its own group in the answer — because
*somebody said so* and *a name implied it* are not the same evidence.

## What it reports

```text
story:checkout--new-flow ← story:checkout--default (content, structure)
  `story:checkout--new-flow` differs from `story:checkout--default` in content
  and structure, led by `Checkout`. The difference is `v1:9f2a11c4e77b`, and it
  is unchanged for as long as the two subjects keep moving together.
  components: Checkout, Button
```

The digest is the part worth reading twice. It is taken over the difference
itself, so it holds still when *both* sides move the same way — a token edit
that turns the whole suite red leaves it exactly where it was — and it moves
when the variation gains or loses something its parent does not have.

That distinguishes two events a reviewer currently has to tell apart by hand:

- **everything moved**, and the flag still does what it did — already approved,
  nothing new to look at;
- **the flag now does something else**, which is a review nobody has done.

A variation that renders identically to its parent says so. It means the flag
reached nothing this run could read, which is a finding when the flag was
supposed to change something.

## What it is not

**It is not a verdict.** A dark story is darker than its light parent; a narrow
one is narrower. Reporting that as a regression would be reporting a subject for
existing. Nothing on this axis reaches the exit code, `accept`, or the baseline
store — a run whose only news is a variation is a green run.

**It is not a variant language.** There is no viewport list, no scheme list, no
flag list. This tool cannot produce a variation and does not try to name one; it
compares two subjects because somebody said they were related. An axis nobody
here thought of needs nothing from this project.

**It does not infer an undeclared arm.** A subject whose page chooses its own
arm — a percentage rollout drawing per browser context — still has one subject
id. If two readings land in different arms, ordinary stability analysis reports
the subject as unstable; it does not invent a variation relationship. To compare
the arms as variations, the collector plans each as a separate subject and the
name grammar or a `variance-parent:` tag links them.

**It does not compare two subjects on request.** The pair has to be declared
before the run, by whoever writes the subjects. An ad hoc comparison requested
after the run is outside this surface.

## Reading it

It is in the run artifact, and an agent asks for it by name:

```text
variance_variations                            # every variation, declared or read
variance_variations { "subject": "story:…" }   # one of them
```

`variance report` prints the same section when a run has one, from the same
code — there is no second formatter.

**Further:** [`composition.md`](composition.md) for the other comparison with no
baseline in it,
[ADR-0045](context/adr/0045-a-subject-may-be-a-variation-of-another-subject.md)
for why the link is a tag and why the difference is never a verdict, and
[ADR-0046](context/adr/0046-a-name-may-be-told-what-its-words-mean.md) for why
the format is a grammar rather than a function you write.
