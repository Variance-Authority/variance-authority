# Cases

Every tool in this category is a set of decisions somebody already made for you.
Where the browser runs, where the baseline lives, whether the check blocks the
merge — each is a coin, and each product ships having called it. That is not a
flaw in them; a called coin is what makes a product installable in an afternoon.
It is a flaw *for you* on the day your case is on the other face.

This document is the axis-by-axis version of that. [comparison.md](comparison.md)
asks *what does each vendor do better*; this asks *which side of each coin is
each tool welded to, and what happens to the team standing on the other side*.

**The claim being tested,** stated first so the rest can fail it: this project is
unresolved on the seven infrastructure coins — it can land either face from
configuration — and firmly on one face of the product coins, where it loses. The
last section names every place the coin is welded here too, which is the useful
part.

**Written 2026-08-04, corrected and extended 2026-08-05.** The four commercial products are placed from
[comparison.md](comparison.md), which read vendor pages on 2026-08-02 and carries
the links; nothing about them was re-verified today. **The five entrants added
below are placed by their published architecture and were not verified against
vendor pages at all** — they are here because leaving them out distorts the map,
and each claim about them is structural (where bytes go, who runs the browser)
rather than a feature or a price. Treat every cell about a tool that is not this
one as a starting point for your own reading. Every cell about *this* project
cites the file that makes it true.

---

## Who else belongs on the map

The four in [comparison.md](comparison.md) are the four you get quoted when
somebody says "we should do visual regression". They are not the four you are
most likely to be replacing.

| | Why it belongs | Which coin it re-calls |
|---|---|---|
| **The runner's own matcher** — Playwright `toHaveScreenshot`, `jest-image-snapshot`, `cypress-image-snapshot` | **The real incumbent.** Free, already installed, zero services. More suites run this than run all four vendors combined | Local render, baseline committed, blocking, no review UI |
| **reg-suit** | The purest form of *your compute, your bucket, their glue*: OSS, S3/GCS of your own, HTML report, PR comment | Removes the vendor without removing the workflow |
| **Lost Pixel** | OSS core with an optional hosted platform — the same product on both sides of the hosting coin | Proves the coin can stay unresolved commercially |
| **BackstopJS** | The standalone: a config file, a headless browser, a folder of references, no CI opinion at all | Answers "I have no CI" |
| **Happo** | Vendor workers, but a per-snapshot price and a strong Storybook/story-per-variant story | A second shape of vendor render |

Two more, named and deliberately left off the tables. **Meticulous** is not on
this axis set at all: it records real user sessions and generates the suite,
which answers *which subjects* rather than *how they are compared* — a genuinely
different product that would need its own document. **Applitools Autonomous** is
the same move from the other direction. Both are worth knowing about if your
actual problem is "nobody writes the tests".

---

## Coin 1 — where the browser runs

| Face | Who is welded to it | What it costs you |
|---|---|---|
| **Vendor renders** | Percy, Chromatic, Applitools, Happo | They own browser versions, so their upgrade is your unattributable red — Chromatic's SteadySnap exists to auto-migrate baselines across it. They cannot reach your VPN, your localhost, your staging auth, or a font you licence and do not serve publicly. Percy re-renders **with JS disabled by default** |
| **You render** | Argos, reg-suit, Lost Pixel OSS, BackstopJS, every runner matcher | Your runner image is now part of the baseline's identity. Upgrade it and everything is red at once, with nothing to say why |

**Here: both, and the second cost is answered rather than inherited.** A local
browser — `chromium`, `firefox` or `webkit`, chosen per renderer
([renderer.ts](../packages/playwright/src/renderer.ts)) — or a remote renderer
endpoint you operate, as `"renderer": { "endpoint": … }` in the config
([config.ts](../packages/cli/src/config.ts)). The runner-image problem is not
avoided by hosting; it is made *legible*. A baseline is stored under an
`identityDigest` of the machine that painted it, a run against a foreign
baseline returns `incomparable` rather than red, and the store says which
identity it did find ([durable.ts](../packages/store/src/durable.ts), ADR-0011).

**The face this cannot take:** somebody else's fleet. There is no Safari on real
macOS to rent, and WebKit is not Safari. A team that needs a browser matrix it
does not own is buying Applitools or Percy, and no amount of configuration here
changes that.

## Coin 2 — where the baseline lives

| Face | Who is welded to it | What it costs you |
|---|---|---|
| **Committed to the repo** | Playwright matcher, `jest-image-snapshot`, BackstopJS | Repo weight, binary churn in every PR — but review is `git diff`, a branch carries its own baselines for free, and there is nothing to keep running |
| **A bucket you own** | reg-suit, Lost Pixel OSS | Credentials in CI, lifecycle rules, and a second thing that can be down |
| **The vendor's storage** | Percy, Chromatic, Argos, Applitools, Happo | Retention, residency and deletion become questions you ask someone else. Argos is **US-only** |

**Here: all three, and this one is an ADR rather than a feature** —
[ADR-0016, *where a baseline is kept decides nothing*](context/adr/0016-where-a-baseline-is-kept-decides-nothing.md).
Five backends satisfy one `RasterStore` contract: nothing stored at all
(ephemeral), a directory ([durable.ts](../packages/store/src/durable.ts)),
git-LFS ([lfs.ts](../packages/store/src/lfs.ts)), an HTTP store you run
([remote/store.ts](../packages/remote/src/store.ts)), and Cloudflare
([tribunal/store.ts](../packages/tribunal/src/store.ts)). Every path decision is
delegated to one implementation, so the identity partition exists once.

The committed face is taken deliberately rather than tolerated, and the argument
is in [lfs.ts](../packages/store/src/lfs.ts): the usual objection to committing
derived state is that it puts machine output under human merge resolution, and
that objection does not reach an image. A baseline is never merged — a conflict
is settled by taking one side, in seconds, and cannot be got subtly half-right.
That is exactly the property a *record of hashes* lacks, which is why the record
is a service and the images are files.

**Caveat, and it is a real one:** git-LFS has never been exercised as git-LFS
([comparison.md §4.2](comparison.md#42-nothing-above-the-cli-boundary-has-been-run)).
The code reads and writes ordinary files at LFS paths and refuses a pointer file
by name; nobody has run it through a real filter on a real clone.

## Coin 3 — blocking the PR, or a side job

**Corrected 2026-08-05.** An earlier version of this table had the category
mostly on the blocking face. That is wrong, and Chromatic is the clearest
counter-example: the CI job publishes, the job ends, and the review happens in
their UI afterwards — `--exit-zero-on-changes` is a documented flag precisely so
the job does not gate the merge. **Non-blocking is the norm, not the exception**,
and a tool that can only block is the one with the missing face.

| Face | What it costs you |
|---|---|
| **A required check** — the runner matchers by construction; anything the vendors do only if you make their status check required | Every flake is now a merge block, which is how `maxDiffPixels` gets raised and never lowered |
| **A side job** — Chromatic by design, and most real Argos and Percy setups | Nobody looks at it. A signal off the critical path decays |

**Here: whichever, and the second face was missing until today.** The exit code
is the interface ([ADR-0017](context/adr/0017-the-exit-code-is-the-interface.md)),
so blocking is the default and needs no configuration. Not blocking used to mean
`|| true` — which also swallows **exit 2**, so a job whose browser never launched
posts a green tick over a suite that observed nothing. `variance run
--exit-zero-on-changes` suppresses exit 1 only, leaves operator errors at 2, and
writes one line to stderr saying the code was suppressed, because a silently
rewritten exit is indistinguishable in a log from a run that found nothing.
`variance comment` then writes the one PR comment that leads with causes rather
than a count ([ADR-0019](context/adr/0019-one-comment-that-leads-with-causes.md)),
and ephemeral retention lets a side job run with nothing stored at all.

**The thing that makes the choice cheap is not on this coin at all.** Chromatic
needs TurboSnap — a module-graph walk, with a documented list of changes that
defeat it — because a full run is billed and slow. Nothing equivalent exists here
and nothing needs to: a `RenderDocument` is a complete statement of what would be
painted, so if its digest matches the digest the stored baseline was painted from
*under the same identity*, repainting can only reproduce the same image. The
subject settles without a browser touching it
([settle.ts](../packages/raster/src/settle.ts)). Collection is ~7.5 ms warm
against ~65 ms to paint, so "300 subjects of which two changed" costs two paints,
decided by content addressing after the fact rather than by a dependency graph
guessed before it.

## Coin 3½ — who owns reproducibility

Added 2026-08-05 because a reader's lived experience does not fit any coin above:
*Argos runs locally, but does not define a container, and I failed using it.*

That is not a gap in Argos's feature list. It falls out of Coin 1. A tool that
renders in your infrastructure and stores images centrally has silently made
pixel-reproducibility **your** problem, and then not handed you the one artifact
that solves it. Your laptop's font stack is not your CI runner's; the images
disagree; every subject is red and nothing says why.

| Face | Who | The consequence |
|---|---|---|
| **The vendor owns it** | Percy, Chromatic, Applitools, Happo | Reproducible by construction, and unreachable — it is their container, and their upgrade to it is your baseline churn |
| **You own it, and are handed nothing** | Argos, reg-suit, the runner matchers | Works perfectly in CI, and never on the machine of the person who has to review the diff. Pin it yourself, in a Dockerfile nobody wrote |
| **It is made unnecessary** | — | Nothing in the category takes this face |

**Here: the third face, and it is the strongest position this project holds.**
Two mechanisms, neither of them a container:

**Ephemeral retention deletes the problem.** Both images are painted *now*, by
one renderer, in one run. The machine appears on both sides of the comparison and
cancels out, so there is no baseline to be reproducible against and no container
to pin. Nothing else in the table offers this, because everything else in the
table is built around stored images.

**Durable retention makes it legible instead of fatal.** A baseline is stored
under an `identityDigest` of the machine that painted it, so a laptop physically
cannot pick up CI's baselines: the run reports `incomparable` — never red — and
the store says which identity it *did* find
([durable.ts](../packages/store/src/durable.ts)).

That is detection, and detection after a six-minute run is still an afternoon.
So as of today `variance doctor` answers it **before** the run: the store's
layout *is* the partition, so a `readdir` says whether any baseline here was
painted by a machine like this one. When none was, doctor prints
`NOT COMPARABLE HERE`, lays out the store one line per identity, exits 2, and
names both ways out — ephemeral retention, or a `renderer` endpoint carrying the
identity the baselines were written under
([doctor.ts](../packages/cli/src/commands/doctor.ts)). The finding it replaces
was a comment in that same file saying this was *"a question only a run can
answer"*.

## Coin 4 — a small suite, or a big one

| Face | Who is built for it | Where the other face hurts |
|---|---|---|
| **Small** — tens of screens | Runner matchers, BackstopJS | Falls over on cost and on review volume, not on mechanism |
| **Big** — thousands | Chromatic (TurboSnap), Applitools (per-Page pricing, so breadth is free), Argos | Vendor pricing multiplies `pages × browsers × widths`; [comparison.md §1](comparison.md#1-the-dimensions-a-buyer-actually-decides-on) sizes a 200-component library at ~$283/mo on the cheapest realistic plan |

**Here: big is affordable, and as of today it is also readable.** The tier ladder
means breadth costs collection rather than paint. What was missing is what
happens after: a suite split across CI jobs produced one report per shard, so
`variance comment` posted N comments and each shard's exit code spoke only for
its own slice. Both commands now take the shards and answer about the suite —
`variance report shard-*.json`
([merge.ts](../packages/cli/src/commands/merge.ts)) — and the merge refuses the
pairs that were never one run rather than averaging them.

The case that only exists once you shard is the one worth naming: **a subject
every shard filtered out is promoted from `excluded` to `failed`.** Each job
exits `0` having done exactly what it was told, while the suite has quietly
stopped watching a component. Nothing in the vendor row can see that, because
none of them has a coverage list to see it with.

## Coin 5 — a design system, or a product

| Face | Who is built for it | Where the other face hurts |
|---|---|---|
| **Design system** | Chromatic (a story *is* a test, no authoring), Lost Pixel, Happo | A page-level story tells you "this page moved" |
| **Product** | Percy (sitemap, static dir, crawler, URL list), Applitools, Argos via your E2E suite | Attribution stops at the page. Nothing names the component |

**Here: both, since 2026-08-04, through three surfaces** — a built or served
Storybook ([storybook-collector](../packages/storybook-collector)), a map of
served URLs ([route-collector](../packages/route-collector)), and your existing
Playwright suite ([playwright-test](../packages/playwright-test)), where the test
body you already wrote plays the collector's part. The third is the one that
answers login walls and multi-step flows, because your test has already logged in
by the time the fixture is reached.

**One face is refused on purpose:** the route collector is not a crawler. The
URLs are a map the operator writes, because a discovered page is a subject nobody
chose — and a subject nobody chose is a baseline nobody will accept.

## Coin 6 — pixel-exact, or only what matters

| Face | Who is welded to it | What it costs you |
|---|---|---|
| **Exact** | Runner matchers, reg-suit, Argos, BackstopJS | Antialiasing and font hinting are now your problem, permanently, and the tolerance knob is the only answer |
| **Perceptual / structural** | Applitools match levels, Percy's JS-off determinism | You are trusting a heuristic you cannot inspect to decide what "matters" |

**Here: both faces are reported, and that is the actual position.** Two policies
are counted on every comparison — `default` (threshold 0.1, antialiasing
forgiven, which is what a shipped VR tool means by "a pixel differ says") and
`strict` (any channel difference at all)
([policy.ts](../packages/raster/src/policy.ts)). Reporting only the forgiving one
is described there as the single most common way to lie with a pixel
measurement. Above the pixels, the ladder decides at the cheapest representation
that *can* decide — reachability, then a structure and CSS digest, then a
semantic tier — so most verdicts never reach a pixel at all, and the ones that do
arrive with a component name and a `file:line`
([comparison.md §3.1](comparison.md#31-a-diff-that-names-a-component-and-a-file)).

**The face not taken:** there is no floating region, no DOM-anchored ignore
region, and no layout-level match level. Applitools has all three and they are
bought for a reason.

---

## The case table

| Your case | What to run |
|---|---|
| A handful of screens, no budget, no services | The matcher you already have. Stop reading |
| A design system, designers must approve without repo access | **Chromatic.** No contest — see [§5 of comparison.md](comparison.md#5-when-not-to-choose-this) |
| A real browser matrix including Safari on macOS | **Applitools** or **Percy.** Nothing here rents a fleet |
| Your compute, your bucket, no vendor, and the workflow you already know | **reg-suit** or **Lost Pixel OSS** today; this project when it is licensed and published |
| Flaky suite, need to know *which* tests are unreliable over time | **Argos.** Nothing here has ever written a history row ([§4.1](comparison.md#41-nothing-has-ever-recorded-a-history-row)) |
| Nothing may leave your network, ever | Here, or a self-hosted Applitools — with the compliance caveats in [comparison.md](comparison.md) fully read |
| The diff must name a component and a file, not a rectangle | Here. Nothing else in the table does it |
| Behind a login, on your VPN, against a staging build | Here, via the Playwright surface, or Argos via your own E2E suite |
| You want the tool to decide as cheaply as it can, not to paint everything | Here. This is the whole design |
| You render in your own CI and the baselines are never reproducible on a laptop | Here — ephemeral retention removes the baseline entirely, and `variance doctor` says so before the run rather than after it |
| A reporting job, not a merge gate, without `\|\| true` swallowing real failures | Here, via `--exit-zero-on-changes`; or Chromatic, which has had the same flag for years |

---

## Where the coin is welded here too

Stated flatly, because a document arguing for superposition that omits its own
welds is a brochure.

1. **No review UI is deployed.** `tribunal` is written; it has never been stood
   up, and standing it up needs a Cloudflare account. This is the axis these
   products are actually bought for.
2. **No history row has ever been written.** The drift arithmetic, the store and
   the wire protocol are all in [history](../packages/history); `variance accept`
   explicitly refuses to record, because a row carries per-component band hashes
   that a run report does not contain and cannot derive
   ([accept.ts](../packages/cli/src/commands/accept.ts)).
3. **No vendor fleet.** Coin 1, permanently.
4. **No ignore or floating regions.** Coin 6.
5. **One modern surface short.** Cypress, WebdriverIO and Appium are explicitly
   *not* on the list — a reader whose interest is modern tooling does not want
   them, and building them would be breadth bought at the price of the thing this
   project is for. What is genuinely missing is **Vitest browser mode**: a real
   browser, driven by Playwright, with the test body already in the page. The
   jsdom library path and the Playwright fixture both exist; nothing bridges the
   arrangement where the test code itself runs in the browser.
6. **Nothing is published or licensed.** Every package is `private: true`.

A seventh was on this list while the document was being written — *a sharded run
produces N reports and nothing merges them* — and came off it, which is the only
reason to write a document in this shape. See
[surface.md §5](surface.md#5-cost-speed-and-signal).
