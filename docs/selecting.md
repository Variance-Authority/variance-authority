# Running less of the suite

A 300-subject suite where one component moved pays for 300 collections and 300
comparisons to report two. That is the largest single saving available in this
category, and every product in it has an answer:

- **Chromatic's TurboSnap** traces a change through the *bundler's* dependency
  graph and tests the stories it reaches.
- **Percy** and **Argos** do not select for you; you shard.

This selects too, and from a different place. A stored baseline records the
components the document that painted it **actually rendered**
([ADR-0018](context/adr/0018-a-component-hash-covers-its-own-nodes.md)), so *what
this subject is made of* is a fact the last run established rather than one a
build tool predicts. There is no second graph to configure, no stats file to
keep, and nothing that goes stale when a bundler is upgraded.

```bash
variance run --since origin/main
```

```json
{ "source": { "dirs": ["src"] } }
```

The diff is `git diff --name-only origin/main...HEAD` — **three dots**, so the
comparison is against the merge base. Two dots on a branch that is behind `main`
reports every file anybody else merged as changed here, and the selection widens
to the whole suite for a reason nobody can see.

## What it will not do

Everything here is arranged to **over-include**, because the two mistakes
available are not the same size.

A subject observed when it need not have been costs a collection. A subject
*skipped* when it should have been observed produces a green run over an
unwatched surface — and it does so silently, because that subject is not in the
report to be missing from. So every uncertainty resolves toward observing:

| Situation | What happens |
|---|---|
| The subject has no baseline | Observed. It is new; nothing is known about it |
| Its baseline records no component list | Observed. Absent is *unknown*, never *renders nothing* |
| A changed file under `source.dirs` declares no component | **The whole suite runs.** A stylesheet, a token file or a shared helper moves subjects without naming itself in any of them |
| The diff touched nothing under `source.dirs` | The whole suite runs, and says so |
| `git` could not list the diff | The run refuses. An empty diff read as "nothing changed" would narrow to nothing and report success |
| `--since` with no `source.dirs` | The run refuses, for the same reason |

The last three are **refusals or warnings, never silence**. A run that quietly
declined to narrow looks exactly like a selector that decided nothing was
affected, and those are opposite facts about the next run.

## What a skipped subject looks like

It is in the report, with the sentence that skipped it:

```
[not observed] story:checkout--summary
not affected by the diff against origin/main: its baseline records 4 component(s)
and this diff touched none of them (Button, Badge, Toggle)
```

That is the same `excluded` state a shard filter produces, and it behaves the
same way: it does not gate, and `variance report` over several shards
[promotes a subject every shard excluded to `failed`](../packages/cli#sharding-report-takes-more-than-one-file)
— because a subject nobody looked at is the failure sharding introduces and
nothing else can see.

## Where `source.dirs` matters twice

It names where components are declared, and it is also a **declaration about
scope**. A changed file *inside* those directories is one this scan understands,
so a change it finds no component in forces a whole run. A changed file *outside*
them is one nobody claimed could affect a render, and narrowing past it is your
own statement about where your components live.

That is why a diff touching `README.md` does not widen anything, and a diff
touching `src/tokens.css` widens everything.

## What this does not reach

**A component imported but never rendered.** Selection is over what the last run
*painted*, so a subject that would newly render `Button` after this change — a
conditional branch that has never been taken — is not selected by a change to
`Button`. A bundler graph does catch that case, and this does not. The mitigation
is the one already in the table: any change the scan cannot attribute to a
component runs everything.

**A first run.** Nothing has baselines, so nothing can be ruled out, and the
whole suite runs. That is correct and worth expecting: `--since` pays from the
second run onward.

---

**Further:** [`flows.md`](flows.md) for where baselines live ·
[`packages/cli`](../packages/cli) for the rest of the command line ·
[`comparison.md §2`](comparison.md#chromatic) for what TurboSnap does that this
does not.
