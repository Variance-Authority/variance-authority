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
| **Anti-aliasing, text smoothing** | construction | Glyph rasterization is not a property of the box tree. **Measured:** moves a pixel differ by 177px, does not move us, with no threshold set. |
| **Device pixel ratio, retina runners** | environment-key | **Measured:** moves a pixel differ by 3015px. Here `deviceScaleFactor` is part of the key, so a 2× run and a 1× run are different baselines and never meet. |
| **Different machine, GPU, driver** | environment-key | A durable baseline is stored *partitioned by renderer identity*, so a cross-machine comparison is `incomparable` — one sentence, not a day of unattributable red. See [ADR-0011](context/adr/0011-durable-and-ephemeral-retention.md). Or use the ephemeral mode, where there is no second machine to be wrong about. |
| **Fonts substituted or not loaded** | environment-key, **and reported** | Fonts are in the key. The renderer also probes by metrics and names what it did not have, because two runs of a substituted font compare `unchanged` — true, and worthless. |
| **Dates, clocks, dynamic content** | policy | Both arms move; both are right. The difference is what you mask: a pixel differ masks a *coordinate region*, which silences whatever else lands there and breaks the moment layout moves. We mask the *text node*, which follows the content. |
| **Page chrome, status bars, scrollbars** | construction (partly) | Observation is clipped to the subject element, so anything outside it cannot enter the image. **But:** headless Chromium uses overlay scrollbars, so the classic scrollbar reflow does not reproduce in CI at all — a blind spot we share with every headless pipeline, [written up rather than deleted](context/journal/0012-instability.md). |
| **Animations mid-flight** | **nothing** | A transform caught in flight is a computed style value and it reaches the representation. We do not pause animations today. Pause or disable them, as you would anywhere else. |
| **Lazy loading, network latency** | **nothing** | Content that arrives late is a structural difference, and correctly so. Wait for it. |
| **Random seeds, unsorted data** | **nothing** | This is a real change. The fixture is the bug. |
| **Cross-origin stylesheets, third-party iframes** | **nothing** | A sheet we cannot read fingerprints as `unreadable` and compares equal, so a change inside one is invisible. Known blind spot, [ADR-0009](context/adr/0009-sessions-detect-instead-of-rinse.md). |
| **Reindented JSX inside a block** | **nothing** | Renders identically and moves our hash. Ours to fix; a pixel differ gets this one right. |

The last four rows are the honest half of the table. A comparison that only ever
finds in its own favour is an advertisement.

## Test order and shared state

The other half of flakiness is not the camera, it is the suite: subject B fails
only when subject A ran first. The usual fix is to rebuild the world between
subjects, which prevents the problem by paying for it on every subject forever.

We do not rinse. We photograph shared state around each subject and derive what
each subject *read* from its own capture, so pollution becomes a read-write
conflict with a named writer:

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
our own measurements: [journal 0012](context/journal/0012-instability.md), [ADR-0009](context/adr/0009-sessions-detect-instead-of-rinse.md), [ADR-0011](context/adr/0011-durable-and-ephemeral-retention.md)
