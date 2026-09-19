# Measure what a variant changes, not just that it changed

Your suite has variants: a feature flag's second version, the same page in the dark
scheme, a story at a narrow viewport, a route whose backend answers with the empty
state. What each of them does to the page is the difference you care about, and it
is the one difference an ordinary run never reports. This page is for making a run
measure it instead.

A **subject** is one named UI state you asked for and can ask for again, identified
by a stable id like `story:checkout--empty`. Each variant is an ordinary subject with
its own baseline, and every run compares it only to itself. So the difference the
variant exists **for** is the one difference nothing measures: a story added behind
`checkout-v2` is `new` on its first run — one baseline written, an empty diff,
nothing said — and green from then on until somebody edits it. What the flag *does to
the page* is visible by opening two pictures and using your eyes, and is recorded
nowhere.

Link the variant to the subject it varies and the run reads both, compares them to
each other, and reports that difference with an identity of its own.

## What a linked pair reports

```text
story:checkout--new-flow ← story:checkout--default (content, structure)
  `story:checkout--new-flow` differs from `story:checkout--default` in content
  and structure, led by `Checkout`. The difference is `v1:9f2a11c4e77b`, and it
  is unchanged for as long as the two subjects keep moving together.
  components: Checkout, Button
```

The digest is the part worth reading twice. It is taken over the difference
itself, so it stays the same when *both* sides change the same way — a token
edit that turns the whole suite red leaves it exactly where it was — and it
changes when the variation gains or loses something its parent does not
have.

That distinguishes two events a reviewer currently has to tell apart by hand:

- **everything changed**, and the flag still does what it did — already
  approved, nothing new to look at;
- **the flag now does something else**, which is a review nobody has done.

A variation that renders identically to its parent says so. It means the flag
changed nothing this run could read, which is a finding when the flag was
supposed to change something.

## Link by name

Most suites have already written the link down. `checkout`, `checkout-dark`,
`checkout-dark-narrow` — the name spells the axes, in order, and a declaration
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
[suite composition](composition.md), which is a true report of the wrong problem.

## Tell it what the words mean

The rule above reads a name with no help, so it can only walk outwards: a parent has
to be a shorter name that this one extends. Plenty of suites are not shaped that way.
If your baseline is spelled out — `checkout--default`, not `checkout` — then the
comparison you want is between two names of the same length: what is the difference
between the green one and the glass one? Neither of those extends the other, so the
rule above sees two unrelated subjects.

Add a `names` section to `variance.config.json`, the file you pass to
`npx variance run --config`, to say what the words are:

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

That is a fragment: `names` is one top-level key of `variance.config.json`, and every
other key in the file — profile, viewport, subject source, baseline store, report
location — stays exactly as it is. [Your first run](start.md) writes the rest.

List the axes in the order your names write them — the same fixed adjective order as
above, now somewhere a reader can check it. Values are a closed list rather than
a pattern, so `ff-on` is one word and not `ff` plus `on`, and so a name can be
walked *toward* its base: **the first value is the base**, and a name including
it means what a name omitting it means. That is what makes `checkout--default`
the subject `checkout--empty` is measured against, and it is how a suite that spells
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

Two consequences to plan for. Once you configure `names`, the grammar replaces the
rule above rather than backing it up: a name whose words are not in your vocabulary
gets no parent at all. And two subjects that land on the same coordinate are refused
by name, so you fix the names rather than find out which one the run picked.

## Declare the link where a name will not say it

A name states an axis somebody chose to spell out. When there is no such name —
an id from a route list, a subject whose parent lives under another namespace, a
convention this suite is not going to change — state the link outright, with
one tag on the subject that is the variation:

```text
variance-parent:<subject id>
```

Tags rather than a configuration block, because there is no way to express a
variation that works for more than one collector — the adapter that produces the
run's subjects, such as Storybook, a route list or a Playwright fixture. A story
sets args, a route sets a query, a fixture sets a cookie or routes a request.
Whatever produces the variation stays with the collector. The only thing this tool
needs is the *link*, and every collector here already has tags.

In Storybook that is the story's own `tags` array:

```ts
export const FlaggedCheckout = {
  tags: ['variance-parent:checkout--default'],
};
```

Write the id in full — `story:components-button--primary` — or as the
part after the namespace, which is what a story knows about itself. A short form
matching more than one subject in the run is refused by name rather than
resolved by order: a difference attached to the wrong parent, printed with full
confidence, is worse than one not printed at all.

Nothing else changes. The tag is read when the run is planned and used when the
two are compared; it changes no hash, no baseline and no store, so adding one
invalidates nothing.

**A tag always wins, and a name never covers for a tag that failed.** A
`variance-parent:` that resolved to nothing is reported as the mistake it is,
rather than quietly answered with a guess. And a link read off a name says so —
in the record, in the sentence, and in its own group in the answer — because
*somebody said so* and *a name implied it* are not the same evidence.

## What it is not

**It is not a verdict.** A dark story is darker than its light parent; a narrow
one is narrower. Reporting that as a regression would be reporting a subject for
existing. Nothing on this axis changes the exit code, `accept`, or the baseline
store — a run whose only news is a variation is a green run.

**It is not a variant language.** There is no viewport list, no scheme list, no
flag list. This tool cannot produce a variation and does not try to name one; it
compares two subjects because somebody said they were related.

**It does not infer an undeclared variant.** A subject whose page chooses its
own variant — a percentage rollout drawing per browser context — still has one
subject id. If two readings land in different variants, ordinary stability
analysis reports the subject as unstable; it does not invent a variation
relationship. To compare them as variations, have the collector plan each as a
separate subject and link them with the name grammar or a `variance-parent:` tag.

**It does not compare two subjects on request.** The pair has to be declared
before the run, by whoever writes the subjects. An ad hoc comparison requested
after the run is outside this surface.

## Read it

`npx variance report --config variance.config.json` prints the section above when a
run has one.

The same content is in the run artifact — the machine-readable record a run writes —
and an agent asks for it by name:

```text
variance_variations                            # every variation, declared or read
variance_variations { "subject": "story:…" }   # one of them
```
