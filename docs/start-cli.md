# Run visual review from the command line

Four commands make the review loop, and
[`@variance-authority/cli`](../packages/cli/README.md) is all four: `doctor`
checks the machine can paint reproducibly, `run` captures every subject and
writes one report, `report` renders that report for a person, and `accept`
promotes an image you already looked at. This page runs them in order against a
project that already collects subjects, ending on a run that exits `0` because
nothing moved.

This page assumes you already have a **collector** — the module that mounts each
UI state and says when it is ready to be captured. The CLI never navigates, logs
in, or starts your application; that boundary is the collector's. If you do not
have one, pick the shipped adapter for the harness you already run — Storybook,
Playwright, served routes, Jest or Vitest — from
[the first-observation guide](start.md), and come back here for the review loop.

## Confirm the collector's shape

A **subject** is one named UI state you asked for and can ask for again — one
story, one route at one viewport, one component mounted in a test — captured and
compared under an id you choose, such as `checkout/empty`.

The module named by `subjects.collector` must default-export a factory the CLI
calls once per run. Its signature is
`(context: CollectorContext) => Promise<Collector>`, and the object it returns
owns three methods:

```js
// variance/collector.mjs
import { openHarness } from './harness.mjs';

export default async function collector(context) {
  const harness = await openHarness();

  return {
    // Every subject this run will look at, plus the ones this source refuses up
    // front, with a reason each. `context.plan` is the plan the CLI already
    // built from `subjects.ids` or from a Storybook index.
    async plan() {
      return context.plan;
    },
    // One subject: `{ ok: true, document }`, or `{ ok: false, because }` — a
    // refusal carrying a sentence, so the run reports the subject as failed
    // instead of dropping it silently.
    async collect(subject) {
      return harness.collect(subject);
    },
    // Once, after the last subject and before the report is assembled.
    async close() {
      await harness.close();
    },
  };
}
```

`Collector`, `CollectorContext`, `Plan`, `PlannedSubject`, `Collected` and
`SubjectSource` are type-only exports of `@variance-authority/cli`. A module
whose default export is not a function is refused by path before anything is
collected.

Two optional methods are worth knowing about: `collectAlone(subject)` lets the
run re-read a changed subject in a world nothing else has touched, and
`callSites` resolves a changed region to the call site that drew it.

## Start the application the collector reaches

The CLI holds no URL. Nothing in `variance.config.json` names an origin, a port,
or a server, so start whatever your collector talks to before you run anything,
and let the collector carry the address:

- your own collector reaches the application however its code already does — an
  environment variable, a fixed loopback port, a harness it starts itself;
- [`@variance-authority/storybook-collector`](../packages/storybook-collector/README.md)
  takes a `baseUrl` option for a Storybook that is already served, and otherwise
  serves the directory holding `subjects.index` on a loopback port for the run;
- [`@variance-authority/route-collector`](../packages/route-collector/README.md)
  takes full absolute URLs per subject in `routes`, or a `sitemap` URL, or a
  built `directory` it serves itself.

The same goes for readiness. A subject's **ready condition** is the collector's
declaration of when that state has finished settling — for the shipped adapters
a CSS selector per subject id, under a `ready` option with a `readyTimeoutMs`
budget; for your own collector, whatever your harness already waits on. The CLI
does not invent one, and a ready condition that never holds is reported as a
collection failure for that subject rather than captured early.

## Write the config

```bash
npm install --save-dev @variance-authority/cli
npx playwright install chromium
```

```json
{
  "project": "checkout-ui",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": { "kind": "collector", "collector": "variance/collector.mjs" },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": ".variance/report.json"
}
```

The filename is a default, not a rule: `--config` takes any path, and
`variance.config.json` is what it falls back to. Relative paths *inside* the file
resolve against the file's own directory, not the working directory, so the
config can live anywhere as long as it sits in a fixed place relative to the
collector, the baselines and the report. Unknown keys are refused by name.

| key | what it decides |
| --- | --- |
| `project` | the name rows are filed under in a shared history service. Required even with no `history` configured, because rows written under a name nobody chose cannot be re-attributed later. |
| `profile` | how much of the page is observed: `chromium` for a full render, or `jsdom` for structure only, with no layout engine and no animation clock. Not the same choice as `browser`, which names the engine that paints — `chromium` (the default), `firefox` or `webkit`. |
| `viewport` | `width` and `height`, plus optional `deviceScaleFactor` (default `1`) and `colorScheme` (default `light`). All four are part of the identity a baseline is stored under. |
| `retention` | `durable` compares against a baseline image saved by an earlier run, and requires `baselines`. `ephemeral` compares two images produced inside the same run and keeps neither, and refuses `baselines`. |
| `subjects` | where subjects come from. See the three kinds below. |
| `baselines` | where approved images are kept: `directory`, `lfs` or `remote`. |
| `fonts` | the fonts this machine is asserted to have. |
| `report` | where `run` writes, and where `report`, `accept` and `serve` read. |

`subjects.kind` is the most consequential line in the file, and it has three
values. All three need a `collector`; what differs is who names the subjects:

| `subjects.kind` | who names the subjects | other keys |
| --- | --- | --- |
| `list` | the config. `ids` is an explicit array, and an empty one is refused. | `ids`, `collector` |
| `storybook` | a built Storybook's `index.json`, read as a file and never as a running server. | `index`, `collector`, `excludeTags` |
| `collector` | the module itself, from a sitemap, a crawl, or an inventory the application already publishes. | `collector` |

`collector` buys you a subject list you never have to keep in sync by hand, and
costs you a suite whose contents can change with no commit to approve: a page
that stops being published stops being watched. A run names the approved subjects
its plan did not contain, so the removal is reported — but after the fact, not as
a diff.

`baselines.kind` has three values, and the choice is yours because the three fail
in different directions:

| `baselines.kind` | where images live | keys |
| --- | --- | --- |
| `directory` | a path in the repository, committed like any other file. | `root`, `layout`, `records` |
| `lfs` | the same, tracked through Git LFS. | `root`, `pattern`, `layout`, `records` |
| `remote` | a service, not committed; a run that cannot reach it stops. | `endpoint`, `token` |

`directory` and `lfs` are committed, so a repository that gitignores `root`
reports every subject `new` forever without ever erroring. `records` moves the
`.json` records away from the images, which is what keeps a class name or a build
id from producing a diff on every edit that moved no pixel.
[Baseline placement](placement.md) covers the trade in full.

`fonts` holds font identities as `family/weight/style/hash` — for example
`"Inter/400/normal/sha256-abc"`. The hash is of the font's bytes and is yours to
supply, because a page can ask whether a family resolves and can never read the
bytes behind it. An empty array is a complete configuration and the run proceeds:
what you lose is font identity in the baseline key, and every subject carries an
`unverified-fonts` warning. Warnings are recorded and do not hold the run open,
so an empty `fonts` never turns the build red — it only means two machines can
agree on the identity while painting two different cuts of the same family.

## Check the machine

```bash
variance doctor --config variance.config.json
```

Run it in the same machine or CI image that will do the comparing. Doctor reports
on what your config selected, before the first expensive run:

- **profile** — which one is configured;
- **renderer** — it actually launches one, and prints `available`,
  `NOT AVAILABLE` with the launch error, or `not checked` for a remote endpoint.
  Doctor makes no network calls, so a remote renderer, a remote baseline store
  and a history service are reported as configured, never as reachable;
- **identity** — the renderer, engine, platform and scale factor a baseline would
  be keyed under, and the fonts asserted into that key;
- **fonts** — it renders a probe document and reads back which asserted families
  came out missing. This never fails the command: a metric-compatible substitute
  is indistinguishable from the real file from inside a page, so doctor prints a
  known limit instead of a verdict;
- **baselines** — the kind, the identities already in the store, and
  `NOT COMPARABLE HERE` when nothing in it was painted by a machine like this one;
- **renders** — the size of the render cache and where it is;
- **history** — configured or none.

Doctor exits `2` for exactly two findings: no renderer could be opened here, and
no baseline in the store is comparable here. Both are yours to fix before
running. For a missing renderer, read the launch error it prints — usually an
uninstalled browser binary or a missing system library. For an incomparable
store, either point `renderer` at a machine running the identity the baselines
were written under, or switch to `retention: "ephemeral"`, where both images are
painted in the same run. Everything else, missing fonts included, exits `0`.

## Run, review, accept, rerun

```bash
variance run --config variance.config.json
```

Under `durable` retention the first successful run exits `1`, because every
subject is `new`: the run captured it, and nobody has yet agreed what it should
look like.

Render the report as a page and open it:

```bash
variance report --config variance.config.json --format html > .variance/report.html
```

The redirect writes the HTML wherever you point it, and image paths inside the
page are relative to the JSON report — so write it into the same directory as
`report.json` and keep the image directory beside it when you copy the pair into
a CI artifact. The page needs no server and no account.

The page shows one card per subject that needs a decision. Each card carries the
subject id in its heading, the changed region with its component and `file:line`,
and a paste-ready command block holding that id already filled in:

```
variance accept checkout/empty
variance report --subject checkout/empty
```

Copy the id — it is the same id your collector planned, `checkout/empty` here —
and promote it:

```bash
variance accept --config variance.config.json checkout/empty
variance run --config variance.config.json
```

`accept` copies the image the reviewed run produced, together with its
**sidecar** — the `.json` written beside it holding that image's width, height,
document digest, renderer identity, missing fonts and component hashes — into
the baseline store, under the key that digest and identity make. That is why a
later run can settle an unchanged subject on 32 hex characters without painting
anything. `accept` opens no browser and reads no document: its inputs are the
report and the files it points at, and a candidate whose sidecar cannot be read
is refused by name rather than replaced.

The rerun exits `0` once the subject is `unchanged` and nothing else is open.

`accept --all` promotes every candidate in the report with one command —
subjects that are `new` and subjects that are `changed`, identically, whether or
not anyone opened the page. Name ids explicitly in anything unattended, and keep
`--all` for the moment you have just reviewed the whole report yourself.
`accept --message-file` writes a commit message describing the promotion, which
`variance changelog` reads back later.

## Read what came back

A run gives every subject one verdict:

| verdict | what it means |
| --- | --- |
| `unchanged` | the stored baseline and the new capture were comparable, and nothing differs. |
| `changed` | pixels moved. The report names the region, the component and the `file:line`. |
| `new` | the subject was captured and no approved baseline exists. |
| `ignored` | pixels moved, and every one of them fell inside a subtree your `ignore` rules excluded. |
| `incomparable` | the comparison was refused because the two images were not made under the same renderer identity — engine, platform, scale factor, fonts or stabilization. The report names which. Never read it as zero difference. |

A subject the run could not observe at all gets no verdict. It is listed
separately as excluded, failed or unreached, with a sentence saying why.

Three exit codes, and a verdict never shares one with a crash:

| exit | meaning |
| --- | --- |
| `0` | nothing needs review, and the run accounted for every subject. |
| `1` | the run completed and found something a person must decide about. |
| `2` | the run did not happen as configured — bad config, missing browser, unreachable store. Never a statement about your UI. |

Six things take a completed run to `1`: a `changed`, `new` or `incomparable`
verdict; a subject the run meant to observe and could not; a subject that was
read twice with nothing changed in between and disagreed with itself, outside
what it declared it asserts on; and an `error` diagnostic, which means the run
looked at less than the whole subject — a stylesheet served cross-origin and
skipped on both sides compares clean while the styling was missing from both
images.

`--exit-zero-on-changes` turns `1` into `0` on `run` and `report`, for a job
that reports rather than blocks a merge. It leaves `2` alone, which `|| true`
does not: a job whose browser never launched observed nothing, and `|| true`
reports it as passed anyway.

## Go deeper

Read [baseline placement](placement.md) before moving baselines to Git LFS or a
remote store, and [composition](composition.md) before folding results into
policy. The [`@variance-authority/cli` reference](../packages/cli/README.md) owns
the full config, command, exit, selection, reporting and CI contracts, including
`run --since` for selecting only the subjects a diff can reach, `run --flakes`
for finding subjects that disagree with themselves, and `variance ask` for
querying a finished run from a shell.
