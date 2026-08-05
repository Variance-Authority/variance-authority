# Ignores

Some of what a page renders is not the subject. A clock, a carousel, an embed
somebody else controls — they move on every run, and no amount of correctness
elsewhere makes a suite usable while they do.

This page is how you say so, and — more importantly — what the run says back.

## An ignore is not a tolerance

This project has no thresholds. Not as an oversight: a tolerance is an anonymous
number, chosen by whoever wrote the default, that hides anything small enough to
fit under it. Nobody can tell you what a given run's tolerance absorbed, because
nothing recorded it.

An ignore is the opposite in every respect that matters.

| | a tolerance | an ignore here |
|---|---|---|
| Scope | the whole image | one named place, or one difference shape |
| Author | whoever chose the default | you, in your config, by name |
| Reason | none is recorded | required — a rule without one is refused |
| What it hides | anything that fits under the number | exactly what it says, counted every run |
| When it stops | never | the run it absorbs nothing, it is reported |
| Verdict it produces | `unchanged` | `ignored`, which is a different word |

The last two rows are what make ignores safe to have. A mask that outlived its
flake is a hole in your suite that nobody can see, so every run tells you which
of your rules caught nothing — and a subject that went green because you declined
to look at it never reports the same word as a subject that genuinely did not
change.

## Two ways to name what is not the subject

### By place — a selector

The common case. You know which element is noisy.

```json
{
  "ignore": [
    {
      "id": "dashboard-clock",
      "reason": "renders wall time, which moves every run",
      "select": ".site-header time"
    }
  ]
}
```

The selector runs inside each subject, and the subtree it picks is excluded on
**both tiers from one declaration**: the semantic comparison drops every
difference under that node, and the pixel comparison subtracts the box that node
occupied before counting anything. Two declarations would let the tiers disagree
about what the subject is — and a region excluded semantically but still compared
on pixels reports `unexplained`, the loudest verdict this system has, about
something you already said was not the subject.

**Which tier your run reaches is worth knowing.** `variance run` compares images
against a stored baseline, so the pixel half is the half that decides its
verdicts. The semantic half — `applyIgnores` over a pair of snapshots — applies
where two documents are compared, which means composing `core` yourself: a stored
baseline carries the component hashes of the document that painted it
([ADR-0027](context/adr/0027-a-baseline-carries-what-its-document-said.md)), which
is enough to name the component that caused a change and not enough to re-run the
differ. The declaration is the same either way, which is the point of resolving it
once on the snapshot.

There is no coordinate form. A rectangle stops covering the thing it was drawn
around the first time the layout moves, and the case that would justify one — an
imported PNG with no document behind it — is [not something this project
accepts](../README.md#scope-and-non-goals).

### By shape — a fingerprint

The one that matters at scale, and the one to reach for when a flake moves
around.

A **fingerprint** is a digest of a difference with its position removed, so the
same artifact anywhere in a subject digests the same.

There are two, and `variance run` publishes and matches the *pixel* one — the
change mask cropped to its own bounding box, resampled onto a fixed grid, with
its aspect and its magnitude bucketed alongside. It knows shape and size and
knows nothing about which component produced it, so two unrelated components
whose residue looks alike collide. The *semantic* fingerprint, which does carry
the component, is `fingerprintOfRoot` and applies where two documents are
compared — the library path, not the binary's.

```json
{
  "ignore": [
    {
      "id": "avatar-crop",
      "reason": "the avatar CDN serves two crops of the same image",
      "fingerprints": ["v1:2c4f9a1e0b7d3856a91c4e2f8b06d735"]
    }
  ]
}
```

You do not invent these. Every region a run reports carries its own fingerprint,
so the way to write one is to copy it off the run that annoyed you.

The reason to prefer it: **a fingerprint ignore does not blind the region it
covers.** A different regression in the same place has a different shape or a
different magnitude, so it is still reported — a rule written for a 12×12 flaky
badge does not absorb a 96×96 card that has gone solid. A coordinate mask cannot
make that distinction and never will. This is
[`mask-fingerprint`](https://github.com/argos-ci/mask-fingerprint)'s idea, which
Argos got right.

What it cannot do is tell two components apart by itself. It is a picture of a
shape, so scope it with `subjects` when the same shape means different things in
different places.

## Cases

### A clock, a date, or a relative timestamp

Place. The element is stable even though its text is not.

```json
{ "id": "clock", "reason": "wall time", "select": "time[datetime]" }
```

The difference between this and a pixel tool's coordinate mask is what happens
when the header gets taller: here the exclusion follows the element, because it
*is* the element.

### A carousel, a marquee, or anything that animates

Place, and consider whether you want it at all. An animation caught mid-flight is
a computed style value that genuinely reached the representation — see
[flakiness](flakiness.md). Pausing it is better than ignoring it, and ignoring it
is better than deleting the subject.

```json
{ "id": "hero-carousel", "reason": "auto-advances on a 4s timer", "select": "[data-carousel]" }
```

### A third-party embed you do not control

Place, scoped to where it appears. Narrow by default: an embed in one route
should not be silenced in every subject that happens to match.

```json
{
  "id": "support-widget",
  "reason": "vendor iframe; version and copy change without our deploys",
  "select": "#support-root",
  "subjects": ["route:/help*", "route:/contact"]
}
```

`*` matches any run of characters. A pattern with no `*` is an exact subject id.

### An image that re-encodes

Shape, not place. The element is fine; the *bytes* are not, and only sometimes.

```json
{
  "id": "avatar-crop",
  "reason": "gravatar serves two crops of the same source image",
  "fingerprints": ["v1:2c4f9a1e0b7d3856a91c4e2f8b06d735"]
}
```

Excluding the avatar by place would also stop reporting an avatar that vanished.
Excluding it by shape does not.

### A flake you cannot place

Shape. This is the case a place-based ignore genuinely cannot serve: the thing
moves, so there is no stable node to name. Take the fingerprint from the run and
scope on it.

### Only in one story, only in one route

Add `subjects`. It composes with either form.

```json
{
  "id": "sparkline",
  "reason": "seeded from Math.random in the story args",
  "select": ".sparkline",
  "subjects": ["story:charts-sparkline--*"]
}
```

### Wherever a story says it applies

Add `tags`, and let the story declare itself. Storybook's built index carries a
story's `tags`, so this works with no central list of ids to keep in step:

```jsx
export const LiveFeed = {
  tags: ['volatile'],
  render: () => <Feed />,
};
```

```json
{
  "id": "live-feed",
  "reason": "polls every second",
  "select": "[data-feed]",
  "tags": ["volatile"]
}
```

**Selection lives in the tag; definition lives in the config.** What a subject
*is* belongs next to the subject, in its own name — a list of ids in a central
file is stale the moment somebody renames one. What a word *means* belongs
somewhere a typo can be caught, which markup is not.

`tags` and `subjects` **intersect**: a rule naming both applies where both hold.
An ignore is the one setting that makes a run less observant, so where two
readings exist the narrower one is correct, and a union is two rules.

A tag no subject wears is reported by name at the end of the run, with the worn
tag it is one edit away from:

```
  [unworn] live-feed — no subject in this run carries `volatle`
    (did you mean `volatile`?); the rule applied nowhere
```

That line is the only defence a tag has. A misspelled *key* is refused by name,
because every object in the config is closed; a misspelled *tag* is a legal word
that simply matches nothing. Story parameters would be a richer surface and are
not offered: a built `index.json` carries `tags` and does not carry
`parameters`, so a declaration written there does not survive the build that
`variance run` reads.

### Only until the fix lands

Add `until`. On the day after that date the rule stops absorbing and starts being
reported, and whatever it was hiding comes back with no further action from you.

```json
{
  "id": "legacy-table",
  "reason": "row heights drift under the old grid; PROJ-4412 replaces it",
  "select": ".legacy-table",
  "until": "2026-10-01"
}
```

`until` is the last day the rule holds, not the first day it does not.

An expiry is the difference between an ignore and a decision nobody revisits. The
default lifetime of a blind spot should be "until somebody decides again", and
this is the field that makes that the easy option.

### Markup you would rather annotate than configure

Add `data-variance-ignore` to the element. The attribute's value is the rule id
it is recorded under.

```html
<div data-variance-ignore="live-feed">…</div>
```

This is honoured whether or not you have an `ignore` block, and it never enters a
hash — adding the attribute to a component does not re-baseline every subject
that renders it. What it does not get is a `reason`, an expiry, or a line in the
per-rule ledger below, because none of those live in markup. Prefer the config
for anything you intend to keep.

## What the run tells you back

Every run prints a ledger. It is the reason ignores are safe to have here, and
it is worth reading even when everything is green.

```
IGNORED — 1284 pixel(s) absorbed by 3 rule(s); 12 subject(s) differed only there
  dashboard-clock — 1284px in 12 subject(s): renders wall time
  [dead] hero-carousel — excluded a subtree in 40 subject(s) and absorbed nothing
    (auto-advances on a 4s timer); the flake it was written for may be fixed
  [dead] support-widget — matched nothing in any subject (vendor iframe); either it
    is no longer needed, or its selector stopped matching and something you believe
    is silenced is being reported
```

Three states, and they need different actions:

| Line | What happened | What to do |
|---|---|---|
| a count | the rule absorbed differences | nothing |
| `[dead]` … `absorbed nothing` | it found its element and there was no difference in it | consider deleting it; the flake may be fixed |
| `[dead]` … `matched nothing in any subject` | the selector resolved nowhere | fix or delete it — you believe something is silenced and it is not |
| `[expired]` | past its `until` | the differences are being reported again; decide again |

The second and third are the ones a coordinate mask can never tell you, and they
are the reason a masked suite rots.

## `ignored` is not `unchanged`

A subject whose only differences fell inside an exclusion reports **`ignored`**.

It is green. It exits `0`. It is not `unchanged`, and the two are never spelled
the same way, because a suite has to be able to answer *how much of my green did
I earn and how much did I declare*. Folding the two together loses that question
permanently.

The same rule governs a band a profile cannot observe, which reports `unobserved`
rather than passing ([ADR-0002](context/adr/0002-observation-profiles.md)). An
ignore is the second reason not to have looked, and it gets the same treatment.

Reported per subject, in the report and in `variance report`:

```json
{
  "subject": "route:/dashboard",
  "verdict": "ignored",
  "because": "412 pixel(s) differ and all of them fall inside 1 excluded region(s); nothing outside them moved",
  "changedPixels": 0,
  "ignored": { "pixels": 412, "boxes": 1, "inert": 0, "byRule": { "dashboard-clock": 412 } }
}
```

`changedPixels` is net of exclusions and `ignored.pixels` is what they took, so
the two are never added by accident.

## Asserting on less, instead of ignoring more

A route-level test and a component-level test want opposite things from the same
machinery. A component's test asserts on everything: a colour token moved and
that *is* the change. A route's test asserts the page still assembles — the nav
is where it was, the sidebar did not collapse — and a design-system token landing
in forty routes is noise it should never have been shown.

That is not an ignore, and writing it as one would mean listing every element
that might be restyled. It is a **sensitivity**: a declaration of which frequency
bands a subject is asserted on at all.

| level | asserts on | absorbs |
|---|---|---|
| `strict` | everything | nothing — the default |
| `layout` | `a11y`, `geometry` | `token`, `content`, `texture` |
| `content` | `a11y`, `content` | `geometry`, `token`, `texture` |

**This is not a threshold, and the difference is the whole point.** A threshold
absorbs anything small enough; a band absorbs exactly one kind of thing however
large it is. A route declared `layout` still reports a nav that moved by one
pixel, and never reports a rebrand that repainted every surface on the page.

`a11y` is in every level deliberately. A control that lost its accessible name
repaints nothing and moves nothing, and a route test blind to it would be
asserting on the shape of the page while ignoring the shape a screen reader sees.

Everything an ignore owes, a sensitivity owes: an id, a required reason, a scope,
and a count of what it absorbed — including the count of zero, which is how a
route declared `layout` that nothing has ever restyled gets found.

```
SENSITIVITY — 412 difference(s) not asserted on, by 1 rule(s)
  routes — asserts on layout; absorbed 412 token difference(s) in 38 subject(s):
    a route asserts the page assembles, not what it is painted
```

**Reachable from the library, not yet from the binary.** `applySensitivity` takes
a pair of snapshots, and `variance run` compares an image against a stored
baseline — it holds one document, not two. The declaration surface waits for the
path that has both rather than shipping a config key that parses and does nothing.

## Accepting a shape, instead of silencing it

A recurring difference has two honest answers, and only one of them is an ignore.

- **It is noise.** The subject moves and nothing about the product changed. That
  is an ignore, and everything above applies.
- **It is the new truth.** The change is real, you have read it, and it landed in
  forty screenshots. That is an *acceptance*, and silencing it would be a
  permanent blind spot bought to save forty clicks.

The same fingerprint serves both, which is the point of having one:

```bash
variance accept --shape v1:2c4f9a1e0b7d3856a91c4e2f8b06d735
```

That promotes every subject where the shape is **the whole change**, in one
action, and refuses by name every subject where something else also moved —
because a bulk accept that swept those along would baseline the other change
silently, which is the failure it is most likely to cause and the one nobody
would find afterwards. Subjects the run capped the region list for are refused on
the same grounds: a truncated list is not evidence of what the whole change was.

If the fingerprint appears in no region of the run at all, the command refuses
outright rather than reporting "accepted 0" — the likely cause is a digest pasted
from a different run, and that is worth being told.

## What an ignore cannot do

- **It cannot apply to a subject with no baseline.** A `new` subject has nothing
  to compare against, so there is nothing to absorb. An ignore that quietly
  reshaped a first baseline would be how a defect gets approved into one.
- **It cannot be scoped by band.** A rule must name a `select` or a
  `fingerprints`; anything narrower than that and broader than a place is a
  tolerance wearing an ignore's clothes. The library's own `IgnoreRule` does have
  a `bands` field, and it is deliberately **not** offered in the config: it
  narrows an ignore applied over a *pair of snapshots*, which the binary never
  builds, so a `bands` here would parse, validate and change nothing.
- **It cannot change what is rendered.** Ignores sit outside the environment key,
  so editing one never invalidates a baseline — and never changes an image.
- **It cannot silence a size change.** A subject that resized is reported whatever
  its exclusions cover, because the canvas itself moved.
- **It cannot hide from the ledger.** There is no quiet ignore.

## Coming from somewhere else

| You had | Write this |
|---|---|
| Percy's `percy-css` hiding an element | a `select` rule naming the same element |
| Percy's `data-percy-ignore-region` | `data-variance-ignore="<rule id>"` |
| Argos's `data-visual-test="transparent"` | `data-variance-ignore="<rule id>"` |
| Argos's fingerprint-scoped ignore | a `fingerprints` rule — the same idea |
| Chromatic's `.chromatic-ignore` / `data-chromatic="ignore"` | `data-variance-ignore="<rule id>"` |
| A coordinate mask | a `select` rule; there is no coordinate form, [and why](#by-place--a-selector) |
| A global pixel threshold | nothing. There is no equivalent, [on purpose](#an-ignore-is-not-a-tolerance) |

## Where this is implemented

`packages/core/src/judge/ignore.ts` holds the model and the register,
`packages/core/src/judge/fingerprint.ts` both fingerprints,
`packages/core/src/attribute/mask.ts` the pixel subtraction;
`packages/dom/src/ignore.ts` resolves selectors against a live document, which is
the only step that needs one. The rules it enforces are stated where they are
enforced.
