# A record keeps up with the mainline by its publish delay

**Date:** 2026-11-03

A checkout selects tests from the record the mainline published last. When
that record is older than the checkout's merge base, it was made on a tree the
checkout no longer has. The question: how far behind is it, does selection stay
safe while it is, and does either answer hold on a team of a hundred, or at the
commit rates Shopify and Uber report? Variance exists to make other people's
suites fast, and this repository, with one developer, is where the failure
cannot show.

The answer: a pull request's selection grows with its own change, plus a
residue that grows with the lag. Publishing is what does not scale: a full run
per mainline commit costs the suite once per commit, and the record lags by
commit rate × publish delay.

Method: a set model of the selection; this repository's history and CI; prior
art from web sources, mostly abstracts and engineering posts. Every external
figure names where it came from.

## The model

`C` is the commit the record was made at, `M` the merge base of `HEAD` and
the mainline, `H` the checkout with its working tree. `Δ(X, Y)` is the set of
files that differ from `X` to `Y`, and `Mine = Δ(M, H)`.

- `Δ(C, H) ⊆ Δ(C, M) ∪ Mine`. It is a subset, not equal: a file both sides
  changed can come back to where it was.
- A selection is a union homomorphism, `S(A ∪ B) = S(A) ∪ S(B)`, because it
  charges tests file by file, from the record and from a walk of the import
  graph alike.
- With `C` strictly behind `M`, the selection is `S(Δ(C, H)) ∩ F(Mine)`. `S`
  reads the record made at `C` and the import graph at `H`. `F` is `file`
  precision at `H`: the graph's reach from `Mine`, the tests the record saw
  enter a file in `Mine`, and, when `Mine` deletes a path, every file whose
  imports the scan could not all resolve. The intersection drops what only
  `Δ(C, M)`, the mainline's commits, charged. A file is the coarsest unit that
  keeps its identity from `C` to `H`: a region recorded at `C` does not line
  up with `H` once a line above it moved.

Safety is read against `M`'s outcomes, Rothermel and Harrold's sense: every
test whose outcome can differ between `M` and `H` is kept. Such a test depends
on a file in `Mine` by one of these edges:

| Edge from the test into `Mine` | Caught by |
|---|---|
| A static import at `H` | the graph at `H` |
| A load that existed at `C` | the record |
| A load `Mine` itself creates | the loading file is in `Mine`, so the walk |
| An import of a path `Mine` deletes | the files with unresolved imports |
| A load the graph does not see, added by the mainline between `C` and `M`: a computed `import()`, a file read, a mock or a setup file | nothing |

The last row is the residue. The widening does not grow with the lag: the
unresolved files are a property of the codebase, and the whole-suite exits
move only by `Mine`. The residue's chance does grow with it, about lag × the
rate the mainline adds such loads × the chance one lands on `Mine`.

The lag is counted at the mainline tip. A merge base read from a local
`origin/main` is older still by the time since the last fetch; a pull
request's CI checks out the merge ref, whose merge base is the tip.

A record ahead of `M` is not a gap: the mainline line holds several records,
and a reader rebases onto the one it needs.

## The lag is Little's law

The mean number of commits the record has not caught up with is mainline
commit rate × publish delay.

```bash
git rev-list --count --since='30 days ago' --first-parent origin/main   # 405 → 13.5 a day
gh run list --workflow check.yml --branch main --status success --limit 30 \
  --json createdAt,updatedAt                                           # median 12.9 min, p90 17.0
```

`check.yml` runs once per mainline commit (`concurrency` keyed by `sha`), so
every commit publishes. 13.5 a day × 12.9 minutes predicts a mean lag of 0.12
commits; at the p90 of 17 minutes, 0.16.

Little's law gives the mean only. The distribution comes from sampling a
branch point uniformly over the last 30 days, with every commit published a
fixed delay after it landed:

```bash
git log --first-parent --since='30 days ago' --format=%ct origin/main > times.txt
node lag.cjs 13 < times.txt
```

```js
// lag.cjs: stdin, commit times in seconds; argv[2], publish delay in minutes
const t = require('fs').readFileSync(0, 'utf8').trim().split('\n').map(Number).sort((a, b) => a - b);
const d = Number(process.argv[2]) * 60, n = 200000, h = {};
let sum = 0;
for (let i = 0; i < n; i++) {
  const at = t[0] + Math.random() * (t.at(-1) - t[0]);
  const lag = t.filter((c) => c <= at && c > at - d).length;
  h[lag] = (h[lag] ?? 0) + 1;
  sum += lag;
}
const gaps = t.slice(1).map((c, i) => c - t[i]);
console.log(sum / n, h, gaps.filter((g) => g < d).length / gaps.length);
```

At 13 minutes: a lag of 0 commits 92.2% of the time, 1 commit 5.1%, 2 or more
2.6%, a mean of 0.122. At 17 minutes: 0 commits 90.3% of the time, a mean of
0.161. Gaps between mainline commits are bursty: 46% are under 13 minutes.

## At other people's scale

| Team | Commits a day | Publish delay | Lag in commits | Full runs a day |
|---|---|---|---|---|
| This repository | 13.5 (measured) | 13 min (measured) | 0.12 | 13.5 |
| 100 developers | 40–150 (assumed 0.4–1.5 per developer) | 13–60 min | 0.4–6 | 40–150 |
| Shopify | ~400 | 15–20 min | ~5 | ~400 |
| Uber | ~1,000 | not published | ~0.7 per minute of delay | ~1,000 |

Shopify's figures come from engineering posts of uncertain date: about 400
commits a day to master, about 100k unit tests, a 15–20 minute build on
hundreds of workers. Uber's EuroSys paper says SubmitQueue handles "thousands
of daily commits"; its 2025 post says tens of thousands of changes a month,
about 1,000 a day.

A pull request's selection is not in the table: it costs what `F(Mine)`
reaches, plus the residue above. Publishing is what breaks. A full run per
commit is the suite once per commit, and every minute of delay is lag.

## Two ways to publish without a full run, not built

**A record built in steps.** Ekstazi's invariant is that a test whose
dependencies did not change keeps its trace, so a landed commit's record is
its parent's with fresh traces for the tests its change selects and for every
new test file. The merge queue's run on the landing tree (`check.yml` runs on
`merge_group`) already produces those traces, so the step costs no run beyond
the queue's. A step is cheaper than a full run, not cheap: Ekstazi reported
32% less end-to-end test time on average, 54% on longer suites, and one hub
file here selects 78% of the suite. It needs four things: publish only after
the commit lands; a full run now and then to reset drift from nondeterminism
and from inputs the record does not see; a safe selection inside the queue,
since an unsafe skip there is inherited by every record after it; and storage
shared per test file. Today each suite is one entry: `suite-v1/unit` 7.9 MB,
`suite-v1/integration` 7.4 MB, `suite-v1/chromium` 4.9 MB (`git show
refs/variance/mainline/main:manifest.json`), about 20 MB copied per record
whatever changed.

**A merge log.** Without a queue, a chain can keep the last full run plus each
landed pull request's traces in landing order, each with its merge base `M_i`.
Its traces were recorded on `M_i` plus its change, and `L_i` landed on a
different parent. Two sets go wrong. Traces now stale: tests it ran,
`S_{M_i}(Δ_i)`, whose dependencies the commits between `M_i` and `L_i` also
changed. Traces missing: tests it skipped that those commits made reach its
change, `S_{L_i}(Δ_i) \ S_{M_i}(Δ_i)`. Both are computable from the log, and
repair reruns them, not the suite. With a merge queue `M_i` is the landing
parent, and both sets are empty.

## Order

1. **Keep the publish delay short with what exists.** Several records on the
   line answer a record ahead of the base. Narrowing a record behind the base
   to `file` precision over `Mine` answers the other side.
2. **Measure at a scale this repository cannot show** the two sets a merge log
   would rerun and the bytes a record costs per commit, on a corpus or a
   simulation with a hundred writers (#935).
3. **Then the edge cases:** a record built in steps (#921), the merge log's
   repair, the interval between full runs.

## What does not hold, or is not checked

- Ekstazi's figures are for Java and JUnit; no step-built record has run here.
- Shopify's and Uber's rates come from posts, not measurements; neither
  publishes a publish delay that maps onto a record.
- How often the mainline adds a load the graph does not see is not measured.
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
