# Surface

What an adopter writes, what they install, and what they cannot do.

[`flows.md`](flows.md) answers one question — *how much infrastructure do I stand
up?* — and it is the wrong axis for the question people actually ask first, which
is *how does my suite get in?* The two are orthogonal: the storage rung decides
where a baseline lives, and this decides how a subject arrives. Either can be
chosen without the other.

The short version, before the detail:

| | |
|---|---|
| **Code you write** | For Storybook or a set of served URLs, roughly five lines: a shipped collector plus the facts only you hold. For a Playwright suite, an import. For anything else, three seams — three methods, one and one — and the worked example that measured 341 lines |
| **Packages you install** | Between one and four, chosen by what you already have |
| **Suites supported today** | Storybook end to end with a shipped collector; a Playwright suite through a fixture where the test body is the collector; and any set of served URLs through a shipped route collector. Anything else through the same collector contract — the run takes its subject list from the collector, not from the config, so a new subject source needs no change here |
| **What cannot enter** | An image this system did not paint. Deliberately, and the refusal is a named error |

---

## 1. The three things you write

Nothing is discovered, registered or scanned for. Each seam is a value the
operator supplies, named in a config file or passed as an argument.

### The collector — three methods

`Collector` at `packages/cli/src/commands/collector.ts:109` is the half of a run this
project declines to write, and the reason is in the source above it: planning
from a story index is generic because the index is a file with a documented
shape, and *mounting* a project's components is not — it needs the project's own
bundle, its own providers and its own definition of settled.

```text
plan()     -> subjects to observe, plus the ones this source already refuses, with reasons
collect(s) -> a RenderDocument for one subject, or { ok: false, because }
close()    -> release whatever plan() opened
```

The config names a module path, the CLI imports it by path, and that is the whole
extension mechanism — `loadCollector` at `packages/cli/src/commands/collector.ts:226` is
twenty-five lines of `import()` and a type check. Not a registry lookup, not a
download, not a plugin protocol. "Every tool that has claimed otherwise grew a
plugin system whose failures are undebuggable from either side."

**Size, measured rather than estimated:** `cases/storybook-case/collector/` is
341 lines across three files, 234 of them in the module the config names. The
source comment estimated "about thirty lines" until one was written and was
optimistic by 8×; it now carries the measurement instead.

**That figure is now the cost where no collector is shipped.** Storybook has one
as of 2026-08-04 — [`@variance-authority/storybook-collector`](../packages/storybook-collector)
— and the same case is five lines of code against the same end-to-end test, which
is what [comparison §4.3](comparison.md#43-there-is-one-shipped-collector-and-it-is-storybooks)
now reads as. For every other subject source the 341 is still the honest number
against Percy's twenty-plus SDKs.

### The page agent — one method

If the collector drives a browser, the browser half is
`PageAgent packages/playwright/src/agent.ts:66`, and it is one method:

```text
capture(request) -> a JSON string
```

The harness that calls it owns one Chromium, one page, one navigation and one
bundle injection, and **knows nothing about subjects, variants, React or the
corpus**. That ignorance is the load-bearing property: it is why the same harness
serves a Storybook, a fixture page or a route without acquiring a dependency on
any of them, and why the same agent could sit behind a worker or a device farm
instead of a `page.evaluate`.

`capture` returns a string rather than an object on purpose. Playwright would
happily structured-clone the object, and that would hide the constraint the
transport story depends on — a capture that acquires a `Map`, a DOM handle or a
cycle fails at this boundary rather than three transports later.

### Provenance — one function

Attribution needs exactly two things per element: a component name, and a digest
of what was passed in. `collect()` takes them as a caller-supplied callback
(`packages/dom/src/collect.ts:52`), so the framework is not a property of the
approach — it is a count of implementations, of which there are two:

| Source | Where | Cost |
|---|---|---|
| React fibers | `packages/react/src/resolve.ts` | Nothing to write. Reads the `__reactFiber$…` expando, needs no DevTools hook |
| Two `data-*` attributes | `attributeProvenance`, at `packages/dom/src/attributed.ts:96` | 25 lines here, plus a build step you own that emits them |

The second is what a non-React project uses, and the attributes are dropped
before hashing, so adding the build plugin invalidates no stored baseline. Vue's
`vite-plugin-vue-inspector` already emits an attribute of this shape and Svelte's
compiler knows the component and file for every element — **but no Vue, Svelte or
Angular application has been run through this**, and that is the whole of the
evidence.

---

## 2. What you install

There is no "public API" and no "internals" in this repository. The cut is
different, and [ADR-0013](context/adr/0013-packages-are-named-for-their-requirements.md)
states it: **the first cut between packages is what a consumer must supply.** A
package is named for its requirement and holds only code that has it, so the
question "what does this cost me" is answered by the package list rather than by
a document that drifts from it.

Read down the column you can satisfy:

| Package | Requires | You install it when |
|---|---|---|
| `core` | nothing | Always. The format, the differ, the docket, the rules |
| `dom` | a DOM to read | You collect from jsdom or a live page |
| `react` | a tree `react-dom` rendered | Provenance comes from fibers rather than attributes |
| `playwright` | a browser binary | You want this project to launch one |
| `png` | — (owns `pngjs`, `pixelmatch`) | You compare images yourself |
| `raster` | nothing | Contracts, policies, ephemeral retention |
| `store` | a directory you can write | Baselines live on a disk or in git-LFS |
| `remote` | a service already running | Baselines or rendering live behind HTTP |
| `history`, `server` | a database | Drift across runs — see [flows.md rung 5](flows.md#rung-5--history-drift-across-runs) |
| `report`, `mcp` | a disk / an agent | You read a run's output as a file or over MCP |
| `session` | a DOM | One standing world instead of rinsing between subjects |
| `storybook` | **nothing** | You read a story index. Not a browser: it names the three page methods it drives instead of importing a `Page` |
| `cli` | all of the above | You want the binary rather than the library |

**The bill is demonstrated, not asserted.** Every example and case in this
repository that uses the library rather than the binary depends on exactly the
same four — `core`, `dom`, `react`, `playwright` — and nothing else at runtime.
That is `examples/kitchen-sink`, `examples/todomvc` and `cases/incumbent-case`,
three call sites that were written separately and converged.

Two entries deserve calling out because they are the rule working rather than
paperwork:

- **`observe` is not on the list.** It is the only package in the repository
  where an order is hard-wired, it is named for being one composition, and
  nothing below it imports it. A package claiming to be a tool while depending on
  four requirements is a composition that has not admitted it; this one admits it
  in its first paragraph.
- **The ephemeral store is in `raster` and the durable one is in `store`,** which
  reads oddly in a table of retention modes and is the honest placement: one
  needs a disk and the other does not. The mode whose argument is *no container,
  no pinned runner, no stored artifact* demonstrates that in the package graph
  instead of asserting it in a comment.

**Nothing is published.** The 21 packages are no longer `private: true` — each
carries MIT, version `0.0.0-beta.1` and a repository field, and a pushed `v*`
tag would send every one of them to the registry
([release.yml](../.github/workflows/release.yml)). No tag has ever been pushed,
so `npm install` reaches nothing: the table above prices an install that cannot
yet be performed, and obtaining any of this still means cloning the repository.
What is left is one tag and one install demonstrated from outside a clone,
tracked in [spec 0015](specs/0015-the-first-published-release.md). That is the
top item of [comparison §5](comparison.md#5-when-not-to-choose-this) and it is
not a formality — it is why
[metrics.md M6](metrics.md#m6-time-to-first-verdict-on-a-cold-repository) records
this project's time-to-first-verdict as *unbounded*.

---

## 3. By suite

`SubjectsConfig packages/cli/src/config-sections.ts:81` is a two-arm union, and the second
arm is the general case.

### Storybook

```json
{
  "subjects": {
    "kind": "storybook",
    "index": "storybook-static/index.json",
    "collector": "collector/index.mjs",
    "excludeTags": ["no-variance"]
  }
}
```

Reads what a **built** Storybook declares and refuses anything that is not that:
no browser, no evaluation, no `.storybook/` directory
([ADR-0020](context/adr/0020-read-the-artifact-not-the-configuration.md)). v3, v4
and v5 index shapes parse. Stories move over Storybook's own channel rather than
by reload, so N stories cost one navigation.

Demonstrated end to end: *new (exit 1) → accept (0) → unchanged (0) → 5 of 8
changed (exit 1)* on a build with one component edited, finding exactly the five
stories that render it.

Nothing prunes Storybook's chrome and nothing needs to. The story mounts into
`#storybook-root`, so the preview reset, the addon layout and the error overlay
are outside the subject subtree and are dropped by ordinary CSS applicability
pruning. A Storybook-specific denylist would be a second normalization ruleset
versioned by nobody.

### Any other suite

```json
{
  "subjects": {
    "kind": "list",
    "ids": ["checkout/empty", "checkout/one-item"],
    "collector": "collector/index.mjs"
  }
}
```

`ListSubjects packages/cli/src/config-sections.ts:92` is the arbitrary-suite path. The
CLI branches to `planList`, at `packages/cli/src/commands/collector.ts:211`, and from
there the run is identical — same normalizer, same bands, same docket, same store.

**The two-arm union is a much weaker constraint than it looks, and this is the
most useful fact in the document.** `run()` never reads `config.subjects` — not
once. The subject list is whatever `deps.collector.plan()` returns
(`packages/cli/src/commands/run.ts:169`), and the loop iterates that. What the
`kind` union actually decides is two things: which collector module to import,
and which generic pre-plan to compute *for the collector's convenience*.

So a collector may ignore `context.plan` entirely and return subjects read from a
route table, a build manifest, or a suite's own discovery output — including
`SubjectRef.kind: 'route'`, which the format declares and nothing yet constructs —
with **no change to `packages/cli`**. Adding a genuinely new subject source is a
module in your repository, not a pull request here. The `ids` array becomes a
one-element formality in that case, because the parser refuses an empty one; that
is an ergonomics complaint rather than a closed door.

**The plan is handed to you either way.** `CollectorContext.plan` is populated for
both subject kinds, so a `list` collector that *does* want the generic half
returns `context.plan` from `plan()` and writes no planning of its own. Its doc
comment said "present only for `subjects.kind: 'storybook'`" until 2026-08-03,
which is the reading that costs something — an operator concludes the field is
undefined and hand-rolls what the CLI already computed.

**This path had no worked example until 2026-08-04.** It parsed, it planned, and
it was covered by unit tests in `packages/cli/src/config.test.ts`,
`packages/cli/src/commands/run.test.ts` and
`packages/cli/src/commands/doctor.test.ts` with a fake collector — the arm the
configuration advertised and the repository did not demonstrate, which is the
reverse of the usual failure and was still a failure.
[`@variance-authority/route-collector`](../packages/route-collector) enters
through it, against pages a real server serves, in
`packages/route-collector/src/collector.chromium.test.ts`. What is still absent is
a `variance run` *end to end* over the `list` arm: the collector is exercised
directly, the way the Storybook arm was before `cases/storybook-case`.

### Playwright

Two packages, and which one you want depends on whether you already have a suite.

[`@variance-authority/playwright-test`](../packages/playwright-test) is the
fixture, landed 2026-08-04: `expect(await variance(locator)).toBeUnchanged()`
inside the test body you already wrote. It is the one adoption path that needs no
collector, because a Playwright test has navigated, mounted and waited by the
time the fixture is reached — which is also why it is the answer for anything
behind a login or several steps into a flow. See
[replacing.md §1](replacing.md#1-replacing-expectpagetohavescreenshot).

`@variance-authority/playwright` underneath it is **a renderer and a harness**: a
`Renderer packages/raster/src/renderer.ts:18` — a document in, a raster out —
satisfying the same contract a renderer across a network satisfies, and usable on
its own by a collector that drives its own pages. `cases/incumbent-case` installs
`@playwright/test` and runs it, but as **the incumbent being measured**, not as an
integration.

### jest and vitest

This works today and needs no CLI at all. `dom` collects from jsdom in the
unit-test process; `examples/kitchen-sink/src/measure.test.tsx` scores 38 of 38
corpus cases this way. jsdom is not a cheap browser — it is an earlier gate that
settles the token band and structural geometry before anything renders, and a
band it cannot observe reports `unobserved` rather than passing.

There is no matcher and no snapshot file. You call the library and assert on
what it returns.

---

## 4. What cannot enter, and what the binary cannot reach

### An image this system did not paint

There is no ingest verb; the six the binary has are `run`, `accept`, `report`,
`comment`, `doctor` and `serve`.

This is the most concrete thing Argos does that this cannot — its CLI takes any
PNG from anywhere — so it is worth being exact about whether it is a gap or a
position. It is a position, and it is already written down at
`packages/cli/src/commands/accept.ts:12`: **acceptance promotes an image the run
already produced, and never produces one.** A candidate whose sidecar is missing
is refused by name rather than reconstructed, because an invented document digest
would settle every future run to `unchanged` against an image nobody can
reproduce.

The reason that rule cannot be relaxed for foreign PNGs is arithmetic rather than
policy. A baseline here is a pair — bytes, plus the identity that painted them,
the dimensions, the missing fonts, and the digest of the document they came from.
A PNG arriving from outside has none of the second half, and everything this
project is for is downstream of it:

| Without a document | What is lost |
|---|---|
| no provenance | no component, no `file:line` — the entire attribution claim |
| no bands | no `structure`/`token`/`a11y` split, so no policy that blocks on one |
| no causes | the docket ranks by area, which was measured as backwards by 6× |
| no snapshot | no inspection rules, no locale comparison — the two capabilities that need no baseline |
| no digest | no render cache, and no cheap settlement |

What remains is a pixel count and some region clustering, which is the incumbent.
Accepting foreign PNGs would not extend this tool; it would offer a second,
worse tool under the same command name.

### Three things the library can do and the binary cannot

The distinction matters when reading §6's flexibility claim, because each of
these is a seam that is open in the library and closed in the CLI. A composition
of your own reaches all three; `variance run` reaches none.

| | The library | The binary |
|---|---|---|
| **A renderer across a network** | `connectRenderer` in `remote` satisfies the same contract, identity-guarded | **Closed 2026-08-04.** `"renderer": { "endpoint": … }` selects it, and `"browser": "chromium" \| "firefox" \| "webkit"` selects the engine when it is local. The two are refused together, because the engine belongs to whichever machine paints |
| **Posting a build for review** | the tribunal's ingest route takes one | nothing in `packages/cli/src` or `.github` posts one. An operator writes the HTTP call themselves |
| **One standing world across subjects** | `session`, measured at 3.4× with ~2% probe overhead | no caller. `session` has **zero** consumers in the entire repository — no package, no example, no case. Its only import site is the example in its own README, which the documentation gate type-checks and nothing runs |

The third is the one to be careful about, because a measured multiple reads like a
shipped feature. It is a real measurement of a real package that no pipeline in
this repository has ever invoked; an adopter using it would be the first caller.

---

## 5. Cost, speed and signal

One claim unifies all three: **each is managed by choosing a representation, not
by tuning a threshold.** Details live in three documents; the shape is here.

**Cost has no unit,** because there is no vendor. Compute is the operator's and
storage is a directory, a git-LFS pointer or an endpoint they run. The bill is
engineering time, and the number to beat is small — about **$283/month** for a
200-component library at 100 PR builds on Chromatic Starter with TurboSnap
([comparison §1](comparison.md#the-one-commercial-fact-worth-isolating)). The
compute for the same 600 subjects is single-digit CI-minutes. The compute is not
the bill and never was.

**Speed is four multipliers, each with a file behind it** — cruft removal before
comparison, one warm browser instead of one per subject, one standing world
instead of rinsing between subjects, and deciding semantically before rendering.
The README tabulates them; [comparison §3.3](comparison.md#33-deciding-at-the-cheapest-representation-that-can-decide)
records that three of the six rows are asserted by no test, and that the cheap
tier's advantage is **~5×, not the ~100× the architecture was drawn around**.

**A reporting job is a flag, not `|| true`.** `variance run
--exit-zero-on-changes` suppresses exit 1 and leaves exit 2 alone, so a
non-blocking check still fails when the browser never launched — which is the
distinction `|| true` destroys. One line to stderr says the code was suppressed.

**Whether this machine can compare at all is answered before the run.** A durable
store is partitioned by `identityDigest`, so `variance doctor` reads the layout
and says whether any baseline in it was painted by a machine like this one. When
none was, it prints `NOT COMPARABLE HERE`, lists the store one line per identity,
exits 2, and names the two ways out. That is the failure mode of every tool that
renders in your CI and stores images centrally, and it otherwise presents as
three hundred components regressing at once on a runner nobody touched.

**Sharding is a glob per job and one merge at the end.** `variance run --subjects
<glob>` narrows a run to a slice; `variance report shard-1.json shard-2.json …`
reads them back as one suite, so a split suite still has one exit code and one
pull-request comment. The merge refuses shards that were not one run — differing
renderer identity, retention or `--intent`, or two shards that observed the same
subject — and resolves each shard's `excluded` entries against what the others
observed. The case worth knowing: **a subject every shard filtered out is
promoted to `failed`**, because each shard exits `0` having done exactly what it
was told while the suite quietly stopped watching a component. See
[`packages/cli/README.md`](../packages/cli/README.md).

**Signal is four refusals**, and refusing is the whole technique:

| Situation | What a threshold would say | What this says |
|---|---|---|
| The environment key differs | `unchanged`, or a false alarm | `incomparable` — never compared |
| The profile cannot see the band | pass | `unobserved` |
| Twelve components moved, one was edited | twelve entries, ranked by area | causes first, collateral counted |
| No causes were supplied | ranked by area, silently | ranked by area, **and the report says so** |

The counterweight, stated where it cannot be skipped: a false-*miss* rate is
measured at 0/20 and a false-*alarm* rate has **never been measured**, while one
false alarm is demonstrated — reindenting JSX inside a block element renders at
0px and moves the hash. [`flakiness.md`](flakiness.md) has the full taxonomy
including the rows where this loses.

---

## 6. Why this is flexible, and what flexibility costs

Five properties, ordered by how much weight each actually carries.

1. **Every seam is an argument, not a plugin.** Renderer, store, collector,
   provenance. Nothing is discovered; each is a value passed in or a path named
   in a config file. There is no registry to fail mysteriously. The sharpest
   instance is §3's: the run asks the collector what the subjects are and never
   consults the config, so the config's closed two-arm union constrains almost
   nothing about what can be observed.
2. **The package graph is cut by requirement, so a cost can be declined.** No
   other tool in the category lets you refuse the browser, the image codec or the
   framework binding independently — because no other tool separates them.
3. **Rendering is the operator's, everywhere.** Argos is the only competitor that
   shares this, and Argos then takes the PNG to its cloud.
4. **The artifact is a document, not only an image.** This is the one that
   compounds: a lens written next year reads artifacts stored last year, with no
   re-render. Nine inspection rules and a locale comparison already do it, and
   nothing image-based can — the evidence is not in the representation.
5. **Where a baseline is kept decides nothing**
   ([ADR-0016](context/adr/0016-where-a-baseline-is-kept-decides-nothing.md)), so
   the storage rung can be climbed without re-baselining.

**And the price.** Every one of those five is a choice the operator makes and
then owns. The products in this category are less flexible precisely because they
made the choices, and that is most of what a buyer is paying for: a green check
in an afternoon, from `npx` and a token. Here, four of the five properties above
begin with work.

So the claim is narrower than *more flexible*, and stating it narrowly is the
only version that survives contact with a real evaluation:

> **The choices are declinable, and each declination is priced in the package
> graph rather than hidden in a plan tier.**

Whether that is worth anything depends entirely on whether you were going to make
those choices anyway. [comparison §5](comparison.md#5-when-not-to-choose-this)
lists ten conditions under which you were not, and for most readers at least one
of them holds.

---

**See also.** [`flows.md`](flows.md) — the storage axis, six rungs ·
[`architecture.md`](architecture.md) — why there is no pipeline ·
[`comparison.md`](comparison.md) — where each competitor wins ·
[`metrics.md`](metrics.md) — what would settle the disagreement with a number ·
[`flakiness.md`](flakiness.md) — the position on variance
