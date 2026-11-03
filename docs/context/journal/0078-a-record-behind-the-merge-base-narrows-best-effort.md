# A record behind the merge base narrows best-effort

**Date:** 2026-11-03

A checkout selects tests from the record the mainline published last. When
that record is older than the checkout's merge base, it was made on a tree the
checkout no longer has. The question: what can a selection over it promise,
how far behind is it, and do both answers hold on a team of a hundred, or at
the commit rates Shopify and Uber report? Variance exists to make other
people's suites fast, and this repository, with one developer, is where the
failure cannot show.

The answer: a selection over everything that changed since the record is safe
and grows with the lag; narrowing it to the checkout's own change is faster
and best-effort, with a miss nothing measures yet. The lag is commit rate ×
mean publish delay, and the mean is set by how long the mainline stays red,
not by how long a publish takes.

Method: a set model of the selection, checked against counterexamples; this
repository's history and CI; prior art from web sources, mostly abstracts and
engineering posts. Every external figure names where it came from.

## The model

`C` is the commit the record was made at, `M` the merge base of `HEAD` and
the mainline, `H` the checkout with its working tree. `Δ(X, Y)` is the set of
files that differ from `X` to `Y`, and `Mine = Δ(M, H)`.

What is known: the record at `C`, the traces and outcomes of a whole run; and,
when the mainline is green, that a whole run at `M` passed. That run's traces
are not known until its record is published.

- `Δ(C, H) ⊆ Δ(C, M) ∪ Mine`. It is a subset, not equal: a file both sides
  changed can come back to where it was.
- A selection is a union homomorphism, `S(A ∪ B) = S(A) ∪ S(B)`, because it
  charges tests file by file, from the record and from a walk of the import
  graph alike.

Two selections follow.

**Wide: `S(Δ(C, H))`.** `S` reads the record made at `C` and the import graph
at `H`. This is ordinary selection against the record's evidence: every test
whose dependencies differ from `C` to `H` is charged, the mainline's changes
included, so it costs `S(Δ(C, M))` on top of the checkout's own and grows with
the lag. It is safe against `C`'s outcomes, up to what no record shows, which
spec 0046 lists. A restored file is not a miss here: a test whose recorded
dependencies all hold `C`'s text again ran on that text and passed.

**Narrow: `S(Δ(C, H) ∪ Mine) ∩ F(Mine)`.** `F` is `file` precision at `H`:
the graph's reach from `Mine`, the tests the record saw enter a file in
`Mine`, and, when `Mine` deletes a path, every file whose imports the scan
could not all resolve. The intersection drops what only the mainline's
commits charged, and leans on `M`'s whole run having passed for those. A file
in `Mine \ Δ(C, H)` holds `C`'s text again, so the record's regions line up
with nothing the checkout changed, and it is charged whole.

The first draft of this entry, and #929 as first written, selected
`S(Δ(C, H)) ∩ F(Mine)`. It drops a restoration. `calculate.ts` returns
`price * 0.9` at `C`; the mainline makes it `0.8` by `M`; the checkout puts
`0.9` back. `Mine = {calculate.ts}`, `Δ(C, H) = ∅`, and the selection is
empty. Against the record's evidence nothing is missed: every file the test
loads holds the text it passed on at `C`. Against `M`, the run the
intersection leans on, the test can differ, and the narrow selection
promises to answer for all of `Mine`, so the restored file is charged.

## The narrow selection is best-effort

Against `M`'s outcomes, a test is kept only if it depends on a file in `Mine`
by an edge `F` sees:

| Edge from the test into `Mine` | Caught by |
|---|---|
| A static import at `H` | the graph at `H` |
| A load that existed at `C` | the record |
| A load `Mine` itself creates | the loading file is in `Mine`, so the walk |
| An import of a path `Mine` deletes | the files with unresolved imports |
| A load the graph does not see, added by the mainline between `C` and `M`: a computed `import()`, a file read, a mock or a setup file | nothing |

The last row is not a probability to wait out: one such load and a broken
change goes green. A test `T` whose `import(name)` the mainline pointed at
`feature.ts` after `C`, with `Mine = {feature.ts}`, is in neither the record's
traces for `feature.ts` nor the graph's reach. The wide selection keeps `T`,
since the file holding the `import()` is in `Δ(C, M)` and the record saw `T`
enter it; the narrow one does not.

So a narrow selection is safe at `C = M` and best-effort at `C` behind `M`. Its
miss rate is measurable, by running the wide selection or the whole suite
beside it and counting the tests only they failed, and nothing measures it
today. Three answers are conservative:

- **Read a record at `M`.** The mainline line holds several records; a reader
  that finds none at `M` waits for it, or takes one of the other two.
- **Select wide.** `S(Δ(C, H))`, which pays for the mainline's change.
- **Run the whole suite.**

The widening the narrow selection does is not what grows with the lag: the
unresolved files are a property of the codebase, and the whole-suite exits
move only by `Mine`. The residue's chance grows with it, about lag × the rate
the mainline adds such loads × the chance one lands on `Mine`, and the wide
selection's cost grows with it outright.

The lag is counted at the mainline tip. A merge base read from a local
`origin/main` is older still by the time since the last fetch; a pull
request's CI checks out the merge ref, whose merge base is the tip.

A record ahead of `M` is not a gap: the mainline line holds several records,
and a reader rebases onto the one it needs.

## The lag is the time the mainline stays red

The mean number of commits the record has not caught up with is mainline
commit rate × mean push-to-publication delay (Little's law). The delay is
measured per pushed commit: from the push, taken as the creation of its
`check.yml` run, to the first successful `publish` job of that commit or a
later one, since a later record covers it.

```bash
gh run list --workflow check.yml --branch main --event push --limit 60 \
  --json databaseId,headSha,createdAt,conclusion > runs.json
node publish-delay.cjs runs.json
```

```js
// publish-delay.cjs: per pushed commit, minutes from push to a record that covers it
const { execFileSync } = require('node:child_process');
const runs = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const rows = runs.map((run) => {
  const jobs = JSON.parse(execFileSync('gh', ['api',
    `repos/Variance-Authority/variance-authority/actions/runs/${run.databaseId}/jobs?per_page=100`])).jobs;
  const publish = jobs.find((job) => job.name === 'publish');
  return { pushed: Date.parse(run.createdAt),
    published: publish?.conclusion === 'success' ? Date.parse(publish.completed_at) : undefined };
}).sort((a, b) => a.pushed - b.pushed);
const delays = rows.map((row, i) => (Math.min(...rows.slice(i).map((r) => r.published)
  .filter((p) => p >= row.pushed)) - row.pushed) / 60000).sort((a, b) => a - b);
console.log(delays.reduce((s, d) => s + d, 0) / delays.length, delays);
```

Over 2026-10-27 to 2026-11-03, 60 commits, 9.1 a day:

| Delay | Mean | p50 | p90 | Max |
|---|---|---|---|---|
| Every commit | 206 min | 15 min | 861 min | about 26 h |
| A commit whose own run published (43) | 13.7 min | 12.9 min | 19 min | |

The 17 commits whose own run did not publish all failed, between 2026-10-29
22:13 and 2026-10-30 23:34: one stretch of red mainline. Their records waited
for the next green commit, and that stretch sets the mean. 9.1 a day × 206
minutes predicts a mean lag of 1.3 commits; the record a reader would have
found, sampled every ten seconds over the window, was 1.35 commits behind the
tip on average. With the mainline green the same product is 0.09.

An earlier draft of this entry used the median run duration, 12.9 minutes,
for the mean, and predicted 0.12. A run's duration is not its push to
publication, and Little's law needs the mean.

## At other people's scale

| Team | Commits a day | Mean publish delay | Lag in commits | Full runs a day |
|---|---|---|---|---|
| This repository | 9.1 (measured) | 206 min (measured; 13.7 while green) | 1.3 (0.09 while green) | 9.1 |
| 100 developers | 40–150 (assumed 0.4–1.5 per developer) | 13–60 min while green | 0.4–6 while green | 40–150 |
| Shopify | ~400 | 15–20 min build | ~5 while green | ~400 |
| Uber | ~1,000 | not published | ~0.7 per minute of delay | ~1,000 |

Only this repository's row is measured. The others multiply a reported commit
rate by a delay assumed with the mainline green; every hour it stays red adds
the commits of that hour.

Shopify's figures come from engineering posts of uncertain date: about 400
commits a day to master, about 100k unit tests, a 15–20 minute build on
hundreds of workers. Uber's EuroSys paper says SubmitQueue handles "thousands
of daily commits"; its 2025 post says tens of thousands of changes a month,
about 1,000 a day.

A pull request's selection is not in the table. The narrow one costs what
`F(Mine)` reaches; the wide one adds `S(Δ(C, M))`, which at Shopify's rate is
the reach of five other people's changes. Publishing is what breaks too: a
full run per commit is the suite once per commit.

## Two ways to publish without a full run, not built

**A record built in steps.** Ekstazi's invariant is that a test whose
dependencies did not change keeps its trace, so a landed commit's record would
be its parent's with fresh traces for the tests its change selects and for
every new test file. The merge queue does not produce those today: on
`merge_group`, `check.yml` runs the tests within two imports of the change,
`verify:near`'s wave, not the far wave, and publishes nothing. A record built
from it is partially refreshed: fresh traces for the tests the queue ran, and
for every other test the stand it had, as #921's honest standing keeps it. It
needs the queue's selection to be the wide one against the parent's record,
since an unsafe skip there is inherited by every record after it; a full run
now and then to reset drift from nondeterminism and from inputs the record
does not see; and storage shared per test file. Today each suite is one
entry: `suite-v1/unit` 7.9 MB, `suite-v1/integration` 7.4 MB,
`suite-v1/chromium` 4.9 MB (`git show
refs/variance/mainline/main:manifest.json`), about 20 MB copied per record
whatever changed. A step is cheaper than a full run, not cheap: Ekstazi
reported 32% less end-to-end test time on average, 54% on longer suites, and
one hub file here selects 78% of the suite.

**A merge log.** Without a queue, a chain can keep the last full run plus each
landed pull request's traces in landing order, each with its merge base `M_i`.
Its traces were recorded on `M_i` plus its change `Δ_i`, and `L_i` landed on a
different parent. Two sets go wrong. Traces now stale: tests it ran whose
recorded files the commits between `M_i` and `L_i` changed. Those the log
computes, from its own traces and the diff. Traces missing: tests it skipped
that those commits made reach `Δ_i`. The log gives the part the import graph
at `L_i` sees; a load the graph does not see was never recorded, which is the
residue above, and only a run finds it. The conservative repair reruns the
wide selection of `Δ(M_i, L_i)` against the last full run, or the whole suite.
With a merge queue `M_i` is the landing parent, and both sets are empty.

## Order

1. **Keep the mainline green and the publish short with what exists.** Several
   records on the line answer a record ahead of the base. Behind the base, the
   wide selection is the safe answer and the narrow one the fast one; which
   one a run takes, and how it says so, is #929's to settle.
2. **Measure at a scale this repository cannot show** the narrow selection's
   misses against the wide one, the sets a merge log would rerun, and the
   bytes a record costs per commit, on a corpus or a simulation with a
   hundred writers (#935).
3. **Then the edge cases:** a record built in steps (#921), the merge log's
   repair, the interval between full runs.

## What does not hold, or is not checked

- Ekstazi's figures are for Java and JUnit; no step-built record has run here.
- Shopify's and Uber's rates come from posts, not measurements; neither
  publishes a publish delay that maps onto a record.
- How often the mainline adds a load the graph does not see is not measured,
  so the narrow selection's miss rate is unknown.
- One week of this repository's history holds one red stretch; the mean
  delay over a longer window may differ by a large factor.
- A "green master" branch cut, Chromium's last known good revision, moves the
  lag from the record onto the developer's code and defers the mainline's
  interaction to the merge (Horwitz, Prins and Reps), and CI's merge ref
  already bases a pull request on the tip.

## Sources

- Rothermel and Harrold, *Analyzing Regression Test Selection Techniques*, TSE 1996.
- Gligoric, Eloussi and Marinov, *Practical Regression Test Selection with Dynamic File Dependencies*, ISSTA 2015 (abstract).
- Shi, Zhao and Marinov, *Understanding and Improving Regression Test Selection in Continuous Integration*, ISSRE 2019.
- Elbaum, Rothermel and Penix, *Techniques for Improving Regression Testing in Continuous Integration Development Environments*, FSE 2014.
- Ananthanarayanan et al., *Keeping Master Green at Scale*, EuroSys 2019 (abstract); Uber Engineering, *Slashing CI Costs at Uber*, 2025.
- Shopify Engineering, *Successfully Merging the Work of 1000+ Developers* and *Introducing the Merge Queue*.
- Graydon Hoare, *The Not Rocket Science Rule of Software Engineering* (bors).
- Horwitz, Prins and Reps, *Integrating Noninterfering Versions of Programs*, TOPLAS 1989.
- Chromium, *Useful URLs* (LKGR), https://chromium.googlesource.com/chromium/src/+/2f90dd6/docs/useful_urls.md.
