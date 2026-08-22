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

**A subject can declare which subject it is a variation of.** The two are then
compared to each other, in the same run, and the difference between them is
reported with an identity of its own.

## Declaring it

One tag, on the subject that is the variation:

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

## Or not declaring it: the great green dragon

Most suites have already written the link down. `checkout`, `checkout-dark`,
`checkout-dark-narrow` — the name carries the axes, in order, and a tag beside it
would only repeat what the name says and then drift from it.

So a subject with no tag is asked its own name. Its parent is the longest other
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

**It does not sense an undeclared arm.** A subject whose page decides its own
arm — a percentage rollout drawing per browser context — is not a variation, it
is an uncovered render input, and it still arrives as an unstable component with
a `file:line` in code nobody edited. That is
[spec 0032](specs/0032-a-render-nobody-committed.md), and it is unbuilt.

**It does not compare two subjects on request.** The pair has to be declared
before the run, by whoever writes the subjects. *What is different between
`Button` and `IconButton`*, asked afterwards, is
[spec 0033](specs/0033-two-sides-a-person-chose.md).

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
for why the link is a tag and why the difference is never a verdict.
