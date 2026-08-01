# Helix checkpoint

**Surface:** this file (git-committed). Epitaphs: [`epitaphs.md`](epitaphs.md).
**Cycle:** 3
**Reload budget:** one read. Verdicts only — no deliberation, no candidate lists.

---

## Outcome

M0 spike answers its exit question: **is normalization quality achievable?**

**Answered: yes, under one profile, on one corpus.** No rule had to be abandoned.
Five were wrong and all five were fixable within the existing structure.

**Proof.**

| # | Claim | State |
|---|---|---|
| P1 | A no-op refactor does not change the hash | **met** — 20/20 stable cases agree, including CSS accretion (1007 rules → 1 kept, 99.90% pruned) |
| P2 | A real change produces one root plus counted collateral | **met** — 17/17 changed cases agree; every case declaring a root count reports exactly it |
| P3 | Owner chains resolve to component display names | **met** — chains drive both attribution and differ matching in the measurement |
| P4 | Both profiles agree on the dimensions both can observe | **met** — 38/38 comparable cases; four defects found and repaired to get there (journal 0007) |

```
jsdom     scorable 38   agreed 38/38   false unchanged 0   false changed 0   undecidable 1
chromium  scorable 39   agreed 39/39   false unchanged 0   false changed 0   undecidable 0
P4        comparable 38   agreement 38/38   undeclared divergence 0
```

Capture cost, one Chromium reused across the corpus: **7.5 ms/capture warm vs
205 ms/capture cold — 27.4x** (48 renders, three runs 27.4/28.0/27.4).

**Boundary.** M0 only. Excluded: raster stage, CLI, GitHub Action, MCP server,
cross-repo `inherited`, hosted anything. No push, no publish.

---

## Branches

| id | Branch | State |
|---|---|---|
| B1 | **normalizer** | landed and measured |
| B2 | **provenance** | landed; load-bearing for correctness since ADR-0007, not only attribution |
| B3 | **corpus** | landed; found five defects the implementation's own tests could not |
| B4 | **dual-surface** | landed and measured — both profiles scored, P4 met |
| B5 | **differ** | landed and measured |
| B6 | **per-profile ground truth** | settled by ADR-0008 (undecidable / divergent / undeclared) |
| B7 | **persistent harness** — `packages/harness-playwright`, one browser per run | landed and measured (27x) |

---

## Moves

| id | Branch | Move | Result |
|---|---|---|---|
| M1 | — | Scaffold, ADRs 0001–0003, `core` types | **expected** |
| M2 | B1 | Normalization pipeline | **mixed** — ADR-0003 step 4 was wrong; amended to all-or-nothing shorthand expansion (journal 0004) |
| M3 | B4 | Collector + CSS applicability pruning | **expected** — 99.90% pruned; found a false `unchanged` I had written into whitespace handling (journal 0005) |
| M4 | B1+B4+B5 | Score the corpus | **expected after repair** — 30/37 on first run, 37/37 after five fixes, all five real defects (journal 0006) |
| M5 | B4+B6+B7 | Persistent harness; settle B6; score `chromium`; compare profiles | **expected after repair** — 31/39 on first run, 39/39 after four fixes, all four real defects, one fix backed out for producing a false `unchanged` under `jsdom` (journal 0007) |

---

## Open links

- **Band cardinality — now load-bearing.** Under `chromium` every `token`-band
  change that alters a component's size is reported as `geometry`, because
  `dominantBand` returns the worst band present (4 cases, journal 0007). A project
  blocking on `geometry` therefore blocks on every padding change. This decides
  whether `chromium` is usable as a gate; it is a change to `SemanticDiff`, not to
  the corpus.
- **Profile skip order** (ADR-0002). Measured: a warm `chromium` capture is 7.5 ms,
  not the ~100 ms the ADR's tier table assumed. The gap between the two semantic
  tiers is ~5x, not ~100x, so "skip chromium on a jsdom hit" buys much less than
  the table implies. Still undecided, now with a number.
- **`dialog-open/dialog`** is the only remaining contested case: the subject
  boundary for portalled content is a real open question, not a per-profile one.
- **One machine.** Every rect and the 27x ratio come from one mac, one Chromium.
  Fonts enter the environment key as a caller-supplied string rather than a
  content hash, so a second machine could render different geometry and the key
  would not say so.
- **Corpus validity beyond ourselves.** One corpus, built by us. Both profiles now
  agree on it, which proves the two collection paths implement one ruleset. It
  does not prove the ruleset holds on someone else's component library.

---

## Next

**Band cardinality**, then the raster stage. The first is what makes the
`chromium` verdicts actionable as policy; the second is the only thing that can
turn "27x cheaper than relaunching a browser" into "cheaper than a screenshot",
which is the claim the product is sold on.
