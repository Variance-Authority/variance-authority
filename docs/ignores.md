# Ignores

Some of what a page renders is not the subject. A clock, a carousel, an embed
somebody else controls — they change on every run, and no amount of correctness
elsewhere makes a suite usable while they do.

An ignore declares that boundary, and every run accounts for what the
declaration absorbs.

## An ignore is not a tolerance

[Variance Authority](README.md) applies no global difference tolerance. A tolerance is an
anonymous number, chosen by whoever wrote the default, that hides anything small
enough to fit under it. Nothing records what a given run's tolerance absorbs.

There *is* a per-pixel colour threshold — `DiffPolicy.threshold`, `pixelmatch`'s
YIQ distance — and it is the one number that decides whether two pixel values
count as different at all. It is not anonymous: every comparison is reported
under both `default` and `strict`, so "zero pixels changed" can be told apart
from "zero pixels changed *after forgiveness*", and the policy id is folded into
the plan's digest. Quoting only the forgiving policy is the single most common
way to lie with a pixel measurement, which is why neither is quoted alone.

An ignore is the opposite in every respect that matters.

| | a tolerance | a Variance Authority ignore |
|---|---|---|
| Scope | the whole image | one named place, or one difference shape |
| Author | whoever chose the default | you, in your config, by name |
| Reason | none is recorded | required — a rule without one is refused |
| What it hides | anything that fits under the number | exactly what it says, counted every run |
| When it stops | never | the first run it absorbs nothing, it is reported |
| Verdict it produces | `unchanged` | `ignored`, which is a different word |

Dead-rule accounting exposes a mask that outlives its flake. Every run names the
rules that caught nothing, and a subject that went green because you declined to
look at it reports `ignored`, never the `unchanged` used for a subject that
genuinely did not change.

## Two ways to name what is not the subject

### By place — a selector

The common case. You know which element is noisy.

```json
{
  "ignore": [
    {
      "id": "dashboard-clock",
      "reason": "renders wall time, which changes on every run",
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
on pixels reports the difference as `unexplained` — the finding class that
names a change nothing in the run accounts for — about something you already
said was not the subject.

**Which tier your run reaches is worth knowing.** `variance run` compares images
against a stored baseline, so the pixel half is the half that decides its
verdicts. The semantic half — `applyIgnores` over a pair of snapshots — applies
where two documents are compared, which means composing `core` yourself: a stored
baseline carries the component hashes of the document that painted it, which
is enough to name the component that caused a change and not enough to re-run the
differ. The declaration is the same either way, which is the point of resolving it
once on the snapshot.

There is no coordinate form. A rectangle stops covering the thing it was drawn
around the first time the layout moves. Existing rasters enter through the
library seam, not the CLI configuration path, and carry no document element for
a selector to follow ([`comparison.md`](comparison.md)).

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
      "reason": "gravatar serves two crops of the same source image",
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

The difference from a pixel tool's coordinate mask appears when the header gets
taller: the selector exclusion follows the element because it *is* the element.

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
  "subjects": ["route/help*", "route/contact"]
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

**When the image is never under test at all, blank it instead.** A fingerprint
absorbs the difference after the page has already fetched the image and put its
bytes into the environment key, so a re-exported hero still re-renders every
subject it appears on to reach a verdict that was going to be absorbed. A
[`blank` rule](stabilization.md#some-images-can-be-served-as-nothing) intercepts
it earlier. The trade is the one every ignore makes, made more completely — a
real change inside a blanked image is not reported, and cannot be.

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

A tag no subject carries is reported by name at the end of the run, with the
carried tag it is one edit away from:

```
  [unworn] live-feed — no subject in this run carries `volatle`
    (did you mean `volatile`?); the rule applied nowhere
```

That line is the only defence a tag has. A misspelled *key* is refused by name,
because every object in the config is closed; a misspelled *tag* is a legal word
that matches nothing. Story parameters would be a richer surface and are
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
it is recorded under; a bare attribute with no value is recorded under `marked`.

```html
<div data-variance-ignore="live-feed">…</div>
```

This is honoured whether or not you have an `ignore` block, and it never enters a
hash — adding the attribute to a component does not re-baseline every subject
that renders it. What it does not get is a `reason`, an expiry, or a line in the
per-rule ledger, because none of those live in markup. Prefer the config for
anything you intend to keep.

## What the run tells you back

Every run prints an ignore ledger, including when everything is green.

```
IGNORED — 1284 pixel(s) absorbed by 3 rule(s); 12 subject(s) differed only there
  dashboard-clock — 1284px in 12 subject(s): renders wall time
  [dead] hero-carousel — excluded a subtree in 40 subject(s), 40 of them compared,
    and absorbed nothing (auto-advances on a 4s timer)
  [dead] support-widget — matched nothing in any subject (vendor iframe); either it
    is no longer needed, or its selector stopped matching and something you believe
    is silenced is being reported
```

Each line asks for a different action:

| Line | What happened | What to do |
|---|---|---|
| a count | the rule absorbed differences | nothing |
| `[dead]` … `absorbed nothing` | it found its element and there was no difference in it | consider deleting it; the flake may be fixed |
| `[dead]` … `matched nothing in any subject` | the selector resolved nowhere | fix or delete it — you believe something is silenced and it is not |
| `[expired]` | past its `until` | the differences are being reported again; decide again |
| `[unworn]` | the rule is scoped to tags no subject in this run carries | check the spelling against the run's vocabulary, which the line offers |
| … `none of which was compared this run` | it found its element, and no subject carrying it reached a comparison | nothing yet — this run says nothing either way |

Coordinate masks cannot distinguish a rule whose target held steady from one
whose target disappeared, which is why a masked suite rots silently.

## `ignored` is not `unchanged`

A subject whose only differences fell inside an exclusion reports **`ignored`**.

It is green. It exits `0`. It is not `unchanged`, and the two are never spelled
the same way, because a suite has to be able to answer *how much of my green did
I earn and how much did I declare*. Folding the two together loses that question
permanently.

The same rule governs a band a profile cannot observe, which reports `unobserved`
rather than passing. An
ignore is the second reason not to have looked, and it gets the same treatment.

Reported per subject, in the report and in `variance report`:

```json
{
  "subject": "route/dashboard",
  "verdict": "ignored",
  "because": "412 pixel(s) differ and all of them fall inside 1 excluded region(s); nothing outside them moved",
  "changedPixels": 0,
  "ignored": { "pixels": 412, "boxes": 1, "inert": 0, "byRule": { "dashboard-clock": 412 } }
}
```

`changedPixels` is net of exclusions and `ignored.pixels` is what they took, so
the two are never added by accident.

## Asserting on less, instead of ignoring more

An ignore excludes a named place or difference shape. A
[sensitivity](sensitivity.md) instead declares which frequency bands a subject
asserts on, so a route can watch its assembly without treating every token
repaint as a regression. Sensitivity has its own scope, precedence, and
dead-rule accounting.

## Accepting a shape, instead of silencing it

A recurring difference has two honest answers, and only one of them is an ignore.

- **It is noise.** The subject moves and nothing about the product changed. That
  is an ignore, with the same accounting, scope, and expiry contract.
- **It is the new truth.** The change is real, you have read it, and it landed in
  forty screenshots. That is an *acceptance*, and silencing it would be a
  permanent blind spot bought to save forty clicks.

The same fingerprint serves both, which is the point of having one:

```bash
variance accept --shape v1:2c4f9a1e0b7d3856a91c4e2f8b06d735
```

The command selects subjects whose complete region list carries only the
requested fingerprints, then applies the normal baseline-promotion checks.
Matching a fingerprint alone does not authorize promotion.

| Evidence in the run | Result for `accept --shape` |
| --- | --- |
| Every region matches a requested fingerprint, the candidate image and sidecar are readable, and no promotion refusal applies | Accept |
| A requested fingerprint matches, but another region has a different or missing fingerprint | Refuse that subject: the selection does not cover the whole change |
| A requested fingerprint matches, but the region list is truncated | Refuse that subject: the unrecorded differences are unknown |
| No region matches, including a subject with no recorded regions | Leave the subject out of the selection; refuse the command if no subject matches |
| A selected subject has unabsorbed instability | Refuse, even if its verdict is `unchanged` |
| A declaration absorbs the instability | Apply the remaining checks; absorption alone does not authorize promotion |
| A selected subject is already `unchanged`, with no unabsorbed instability | Report that it is already the baseline; promote nothing |
| A selected, changed subject does not reproduce in a clean world | Refuse: the candidate depends on shared state |
| A selected subject has no candidate image, or its image or sidecar cannot be read | Refuse: approval never renders a replacement |
| Captures are incomparable | No comparison image is produced, so there is no candidate to promote |

The command reports refusals by subject and promotes eligible subjects. Review
additional changes before accepting a refused subject by name. A fingerprint
absent from the run may have been copied from another report.

## What an ignore cannot do

- **It cannot apply to a subject with no baseline.** A `new` subject has nothing
  to compare against, so there is nothing to absorb. An ignore that quietly
  reshaped a first baseline would be how a defect gets approved into one.
- **It cannot be scoped by band from the config.** `IgnoreRule.bands` exists and
  narrows what a rule absorbs in `applyIgnores`, over a pair of snapshots. The
  binary compares images against a stored baseline and never builds that pair, so
  a `bands` written in config would parse, validate, appear to work and change
  nothing — and a config key with no consumer is worse than a missing feature,
  because the operator believes they have it. Narrowing by band from config is
  what `sensitivity` is: declared positively, scoped to named subjects, and
  counted in a register of its own.
- **It cannot change what is rendered.** Ignores sit outside the environment key,
  so editing one never invalidates a baseline — and never changes an image.
- **It cannot silence a size change.** A subject that resized is reported whatever
  its exclusions cover, because the canvas itself changed.
- **It cannot hide from the ledger.** There is no quiet ignore.

## Coming from somewhere else

| You had | Write this |
|---|---|
| Percy's `percy-css` hiding an element | a `select` rule naming the same element |
| Percy's `data-percy-ignore-region` | `data-variance-ignore="<rule id>"` |
| Argos's `data-visual-test="transparent"` | `data-variance-ignore="<rule id>"` |
| Argos's fingerprint-scoped ignore | a `fingerprints` rule — the same idea |
| Chromatic's `.chromatic-ignore` or `data-chromatic="ignore"` | `data-variance-ignore="<rule id>"` |
| A coordinate mask | a `select` rule; there is no coordinate form, [and why](#by-place--a-selector) |
| A global pixel threshold | nothing. There is no equivalent, [on purpose](#an-ignore-is-not-a-tolerance) |
