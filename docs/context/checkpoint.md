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
| P4 | Both profiles agree on the dimensions both can observe | **not started** — only `jsdom` has been scored |

```
settled cases: 37   agreed: 37/37   false unchanged: 0   false changed: 0
```

**Boundary.** M0 only. Excluded: raster stage, CLI, GitHub Action, MCP server,
cross-repo `inherited`, hosted anything. No push, no publish.

---

## Branches

| id | Branch | State |
|---|---|---|
| B1 | **normalizer** | landed and measured |
| B2 | **provenance** | landed; load-bearing for correctness since ADR-0007, not only attribution |
| B3 | **corpus** | landed; found five defects the implementation's own tests could not |
| B4 | **dual-surface** | half — `jsdom` scored, `chromium` never run |
| B5 | **differ** | landed and measured |
| B6 | **per-profile ground truth** — how a corpus expresses an expectation that differs by profile | admitted this cycle; blocks B4 |

---

## Moves

| id | Branch | Move | Result |
|---|---|---|---|
| M1 | — | Scaffold, ADRs 0001–0003, `core` types | **expected** |
| M2 | B1 | Normalization pipeline | **mixed** — ADR-0003 step 4 was wrong; amended to all-or-nothing shorthand expansion (journal 0004) |
| M3 | B4 | Collector + CSS applicability pruning | **expected** — 99.90% pruned; found a false `unchanged` I had written into whitespace handling (journal 0005) |
| M4 | B1+B4+B5 | Score the corpus | **expected after repair** — 30/37 on first run, 37/37 after five fixes, all five real defects (journal 0006) |
| M5 | B4 | Run the corpus under `chromium` via Playwright | *pending* |

---

## Open links

- **P4 is untouched.** Every number above is `jsdom`. The chromium collector code
  path has never executed, so "one implementation, two profiles" is currently an
  argument from construction, not a measurement.
- **Per-profile ground truth (B6).** Two contested corpus cases are contested for
  the same reason: their correct answer differs by profile, and the manifest has
  one expectation field. ADR-0002 says the profiles never share a baseline; it
  does not say how a corpus states an expectation that differs between them.
  **This blocks scoring chromium** — without it, cases will be recorded as misses
  when the profile is structurally unable to decide them.
- **Band cardinality.** Nothing normative says a subject reports one band rather
  than a set. A policy blocking on `geometry` behaves differently under each
  reading (`prop-size/button`).
- **Profile skip order** (ADR-0002): does a `chromium` hit permit skipping
  `jsdom`? Still undecided; needs P4.
- **Corpus validity beyond ourselves.** One corpus, built by us. It proves the
  rules are coherent and the apparatus works. It does not prove they hold on
  someone else's component library.

---

## Next

**M5** — score the corpus under `chromium`, which closes P4. B6 must land first
or the scoring is meaningless for the cases that differ by profile.
