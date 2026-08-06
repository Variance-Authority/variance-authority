# Flakiness

> **Draft.** This page is the position, not the manual. It will grow.

Yes, visual regression is flaky. Anyone who says otherwise has either not run it
at scale or has quietly set a threshold large enough to hide it.

But "is it flaky" is the wrong question, and it is why the usual answers are
retries and tolerances — both of which trade a false alarm for a missed
regression at a rate nobody measures. The question worth asking about each cause
of variance is:

> **What would it take to absorb this?**

Because the answers are not interchangeable. Some causes cannot reach the
representation at all. Some are not variance but two different *baselines*
compared by mistake. Some need a policy, and some are real changes wearing a
flake costume. Only the last two are anybody's judgement call, and lumping all
four under "flaky" is what makes the whole category feel unmanageable.

## The four ways a cause gets absorbed

| Absorbed by | Meaning | Cost to you |
|---|---|---|
| **construction** | The change cannot reach the representation. No threshold, no config, nothing to tune. | none |
| **environment-key** | The two runs are different baselines, not a diff. They are never compared, so there is nothing to explain. | declare the environment honestly |
| **policy** | Both arms see it and both are right. Somebody has to decide. | one decision, once |
| **nothing** | It gets through. | fix the cause, or live with it |

A tolerance is the absence of all four. A tolerance large enough to swallow
rasterization noise is also large enough to swallow a small real change, and
nothing in the output tells you which one it just did.

## The causes, and what absorbs each

The taxonomy of causes below is the industry's, and [Argos documents it
well](https://argos-ci.com/blog/screenshot-stabilization) — they are worth
reading. What differs here is the last column.

| Cause | Absorbed by | Notes |
|---|---|---|
| **Anti-aliasing, text smoothing** | construction | Glyph rasterization is not a property of the box tree. **Measured:** moves a pixel differ by 177px, does not move us, with no threshold set. **And the measurement is macOS-only** — the probe perturbs `-webkit-font-smoothing`, which no other platform implements, so the first Linux run measured 0 changed pixels on both arms (2026-08-03, [checkpoint](context/checkpoint.md)). The absorption argument stands on construction; the 177px does not stand on Linux. |
| **Device pixel ratio, retina runners** | environment-key | **Measured:** moves a pixel differ by 3015px. Here `deviceScaleFactor` is part of the key, so a 2× run and a 1× run are different baselines and never meet. |
| **Different machine, GPU, driver** | environment-key | A durable baseline is stored *partitioned by renderer identity*, so a cross-machine comparison is `incomparable` — one sentence, not a day of unattributable red. See [ADR-0011](context/adr/0011-durable-and-ephemeral-retention.md). Or use the ephemeral mode, where there is no second machine to be wrong about. |
| **Fonts substituted or not loaded** | environment-key, **and reported** | Fonts are in the key. The renderer also probes by metrics and names what it did not have, because two runs of a substituted font compare `unchanged` — true, and worthless. |
| **Dates, clocks, dynamic content** | policy | Both arms move; both are right. The difference is what you mask: a pixel differ masks a *coordinate region*, which silences whatever else lands there and breaks the moment layout moves. We mask the *element* — or the *shape* of the difference, which follows a flake that moves — and report what each rule absorbed every run. [`ignores.md`](ignores.md). |
| **Page chrome, status bars, scrollbars** | construction (partly) | Observation is clipped to the subject element, so anything outside it cannot enter the image. **But:** headless Chromium uses overlay scrollbars, so the classic scrollbar reflow does not reproduce in CI at all — a blind spot we share with every headless pipeline, [written up rather than deleted](context/journal/0012-instability.md). |
| **Animations mid-flight** | **construction**, since 2026-08-06 | A transform caught in flight is a computed style value and it does reach the representation — so the page is now held still *before the subject is read*, not only before it is painted. Pinned at the first frame by CSS, with the recipe's digest in the environment key so an unstabilized baseline is `incomparable` rather than a diff. **Measured:** one page, a 4s animation, read twice a second apart — the hash moves untouched and holds under the recipe ([`stabilization.md`](stabilization.md), [ADR-0029](context/adr/0029-a-page-is-held-still-before-it-is-read.md)). **What still gets through:** JS-driven animation, which no CSS reaches, and animated GIFs. |
| **Lazy loading, network latency** | **construction**, since 2026-08-06 | Content that arrives late is a structural difference, and correctly so — the question is whether you were still waiting when it landed. `wait-for-images` polls `document.images`, which misses anything appended during the wait and has no entry for a `background-image`; the driver watches the wire instead and knows what has been asked for and not answered ([`stabilization.md`](stabilization.md)). A page that never stops fetching is reported, not failed. |
| **An asset whose bytes moved behind its URL** | **environment-key**, since 2026-08-06 | Newly listed, because it was a silent false `unchanged` and nothing here said so: `EnvironmentInputs.assets` existed from the beginning and was filled by nobody, so a re-exported logo compared equal. Every image, font and media response is now hashed into the key by the only party that sees the bytes. |
| **Animated GIFs** | **construction**, since 2026-08-06 | Newly listed for the same reason. No CSS reaches a GIF, so `pin-animations` leaves a spinner spinning. The response is truncated to its first image block on the wire, before the browser decodes it — which needs no canvas and so has no cross-origin case, and returns the author's own bytes rather than a re-encode. **Measured** on real screenshots. |
| **Random seeds, unsorted data** | **nothing**, and reported since 2026-08-06 | Still absorbed by nothing — this is a real change and the fixture is the bug. What is new is that it no longer arrives as a component regression: a changed subject is read twice, and one that disagrees with itself is `unstable`, named with the component and the band. See [below](#what-still-gets-through-and-how-it-is-found). |
| **Cross-origin stylesheets, third-party iframes** | **nothing** | A sheet we cannot read fingerprints as `unreadable` and compares equal, so a change inside one is invisible. Known blind spot, [ADR-0009](context/adr/0009-sessions-detect-instead-of-rinse.md). |
| **Reindented JSX inside a block** | **nothing** | Renders identically and moves our hash. Ours to fix; a pixel differ gets this one right. |

**Three** rows are absorbed by nothing, and they are the honest half of the table.

The count has moved three times and every move is the point. It said "the last
four" until 2026-08-03, which quietly excluded *animations mid-flight* — the one
a reader is most likely to hit on their first run — and became five. On
2026-08-06 animations and lazy loading moved to *construction* and two rows were
**added**: an asset whose bytes moved behind its URL, and animated GIFs. Both
were live false `unchanged` verdicts that this table did not mention, which is
worse than a row admitting a gap.

A comparison that only ever finds in its own favour is an advertisement. A
limitation left standing because writing it down felt like enough is the same
failure with better manners — three of these rows sat here as confessions and
were each a bug with a fix that took an afternoon.

## What still gets through, and how it is found

Prevention is the base layer and it is on by default
([`stabilization.md`](stabilization.md)). What survives it is a residue, and a
residue is worth naming rather than tolerating.

A run that calls a subject `changed` is claiming something about a component, and
there are exactly three ways for that claim to be wrong: an earlier subject left
state behind, the page does not render the same thing twice, or somebody really
did edit something. All three arrive identically — *the pixels moved* — and they
need three different people to do three different things.

So a changed subject is collected a second time, and there are two second passes,
each varying exactly one thing:

| | world | time | answers | reported as |
|---|---|---|---|---|
| **`again`** | held | advanced | does this subject move on its own? | `unstable` |
| **`alone`** | rebuilt | same | did some *other* subject move this one? | `order-dependent` |

Neither is a retry: both outcomes of both are reported, and neither clears
anything. `again` runs first, and when it finds something `alone` is not asked —
its whole inference is *the clean reading differs from the shared one, therefore
the world moved it*, which is only evidence if two readings of one world would
have agreed. Asked in the other order, a page with a clock in it produces a
confident sentence about suite pollution and sends somebody to bisect a run order
that has nothing to do with it. Details in
[ADR-0030](context/adr/0030-two-second-passes-one-variable-each.md).

**What it names.** Not "this subject is flaky" — that is a page to read. The two
readings are two documents, and a document carries its component hashes, so the
answer is a component and a band:

```
[unstable] story:checkout--summary — Clock read differently (content)
```

`content` is data, `geometry` is layout that has not settled, `token` is a style
still being applied. That is the difference between a day and ten minutes, and it
is what a fix can be aimed at.

**What it costs.** One collection, and never a paint: two documents with equal
digests cannot paint differently, so the comparison is a digest comparison. It
runs only on subjects the run already called `changed`, inside the same
`alone.limit` budget, so a green run pays nothing.

**`accept` refuses an unstable subject**, for the reason it refuses order
dependence. The image on disk is one of two readings, chosen by a race, and
promoting it makes the coin flip the thing every later run is measured against.

**Two readings is a floor, not a ceiling.** A subject that reads differently one
time in fifty passes this forty-nine runs out of fifty, and an absent finding
means *this run's two readings agreed* — never *this subject is stable*. The
report says so in those words. Recurrence over a window, which is the shape
[Argos ships](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-test-detection.md),
is a different instrument and is not built here: it belongs to
[spec 0002](specs/0002-history-store.md), which is still blocked on its own
contract decision. Raster-level nondeterminism is invisible to this for the same
reason it is cheap — it does not move a document digest.

### The first thing it found was ours

Five of five changed stories in [`cases/storybook-case`](../cases/storybook-case),
on the first run, and the cause was in this repository.

Blink does not write a mutated inline style back into the `style` attribute
eagerly: `element.style.padding = …` marks the declaration dirty and the attribute
is regenerated the next time anything reads the element's attributes. `outerHTML`
is such a read, and the regenerated attribute is *appended*. So a freshly mounted
component held `[type]` with a pending style, our path stamp appended
`[type, data-va-path]`, and serialization materialized the style at the end.
Collect the same story again with no remount and the style attribute already
exists, so the stamp goes last.

Same tree, same pixels, two document digests — decided by whether the subject had
been read before in that run.

**The verdict was never wrong, which is why nothing had ever reported it.** What
was wrong was the economy: `settle` skips a render when this run's document digest
equals the digest the baseline was painted from, so the cheap tier was switching
itself off depending on the collection history of the run that recorded the
baseline. Silent, permanent, and invisible to every test in the suite. Seven of
the eight stories now produce one digest for two consecutive readings; the eighth
is the one with a clock in it, which is the right answer.

## Test order and shared state

The other half of flakiness is not the camera, it is the suite: subject B fails
only when subject A ran first. The usual fix is to rebuild the world between
subjects, which prevents the problem by paying for it on every subject forever.

We do not rinse. `@variance-authority/session` photographs shared state around
each subject and derives what each subject *read* from its own capture, so
pollution becomes a read-write conflict with a named writer:

```
[confirmed] story:card
  cause:    story:toolbar (rendered by Button, Toolbar)
  via:      sheet:<style:0>
  evidence: re-running `story:card` in the same session produced a different
            render hash with no code change; `story:toolbar` wrote
            `sheet:<style:0>`, which this subject matched via `.card`
  fix:      make `story:toolbar` clean up `sheet:<style:0>`, or scope it so it
            cannot reach `story:card`
```

Measured at **3.4× faster** than rinsing, with the probe costing **~2%** of
session time. Details in [ADR-0009](context/adr/0009-sessions-detect-instead-of-rinse.md).

**A `variance run` does not do that**, and until 2026-08-04 this section said
"we" in a voice that implied otherwise. The probe is a package nothing depends
on. What a run does instead, since 2026-08-04, is cheaper and more general:

> **A subject whose change is gone when it is collected alone was moved by the
> session, not by an edit.**

Only subjects that changed are re-collected, so a green run pays nothing; the
shared render is already cached, so a red one pays a single render per subject,
capped by `alone.limit`. The result is reported as `order-dependent` rather than
`changed`, and **`accept` refuses it** — promoting it would make the leak the
baseline, and the subject would compare clean for as long as the leak survived.

This catches the case the probe's own confirmation tier cannot. `verify()`
re-runs a subject **in the same session**: it varies time and holds the world
fixed, so a leak that happens *every* time never moves the hash and reports as
nothing. That deterministic kind is the one that becomes a false regression
rather than a flake.

**What a run will not tell you is who wrote it.** A probe sees stylesheets,
custom properties, attributes and stray body nodes; the couplings that bite live
in module scope — a singleton store, a cached client, a mocked clock — and touch
no DOM at all. There is no stack to fall back on either. So the run resolves the
outcome the way it resolves every outcome — to a node, a component, a file — and
narrowing to the writer is a bisection over run order. Details and what is left
in [spec 0012](specs/0012-order-dependence-in-a-run.md).

## Where we differ from the state of the art

Argos [detects unstable tests and can auto-ignore a recurring
change](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-test-detection.md)
once its diff fingerprint has appeared some number of times in a window. That is
a good, pragmatic answer, and it works today at a scale nothing here has been
run at.

Our bet is different: **an unstable hash is a finding with a cause, not noise to
suppress.** Auto-ignoring by diff shape silences the symptom without naming the
writer, and the same suppression that hides a flake hides the real regression
that later lands in the same region.

The two instruments differ in what they need and in what they can say. Counting
fingerprints needs a *window* — several runs, and a store to keep them in — and
answers with a probability. Reading the subject twice needs one run and answers
with a component and a band, because the evidence is two documents rather than
two images. The cost of ours is that it only ever fires on a subject the run
already called `changed`; the cost of theirs is that the first several
occurrences are red builds. Neither subsumes the other, and the window half is
[spec 0002](specs/0002-history-store.md)'s, unbuilt.

The honest cost of our bet: suspicion over-reports. A coupling can exist and
never bite, so the read-write pass alone produces findings that a confirmation
run then clears — and a project that never calls `verify()` gets suspicion only.
Every finding carries a `confidence` field for exactly this reason.

## What none of this establishes

Every instability probe we have run **simulates** its cause — a smoothing mode
instead of a different GPU driver, a second browser context instead of a second
runner — because varying the machine is not available from inside a test. Every
number on this page comes from one Mac and one Chromium.

That is a real limit on what the measurements prove, and it is stated here rather
than left for you to work out.

---

**Sources.** [Argos: stabilize screenshots](https://argos-ci.com/blog/screenshot-stabilization) ·
[Argos: flaky test detection](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-test-detection.md) ·
our own measurements: [journal 0012](context/journal/0012-instability.md), [ADR-0009](context/adr/0009-sessions-detect-instead-of-rinse.md), [ADR-0011](context/adr/0011-durable-and-ephemeral-retention.md), [ADR-0030](context/adr/0030-two-second-passes-one-variable-each.md)
