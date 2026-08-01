# Helix checkpoint

**Surface:** this file (git-committed). Epitaphs: [`epitaphs.md`](epitaphs.md).
**Cycle:** 5
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
| B7 | **persistent harness** — `packages/harness-playwright`, one browser per run | landed and measured (27×) |
| B8 | **session** — one standing world, cross-pollution detected rather than prevented | landed and measured (3.5×, ~2% probe overhead) |
| B9 | **impact axis** — reflow vs repaint, orthogonal to the frequency bands | landed; answers B6's leftover band-cardinality question |
| B10 | **intent / adjudication** — declared claims vs findings, and the locate/source chain | landed; a report is a cause, a place and a file |
| B11 | **raster tier** — six phases, two retention modes, MCP surface | landed and measured; found that area ranks the displaced above the displacer |

---

## Moves

| id | Branch | Move | Result |
|---|---|---|---|
| M1 | — | Scaffold, ADRs 0001–0003, `core` types | **expected** |
| M2 | B1 | Normalization pipeline | **mixed** — ADR-0003 step 4 was wrong; amended to all-or-nothing shorthand expansion (journal 0004) |
| M3 | B4 | Collector + CSS applicability pruning | **expected** — 99.90% pruned; found a false `unchanged` I had written into whitespace handling (journal 0005) |
| M4 | B1+B4+B5 | Score the corpus | **expected after repair** — 30/37 on first run, 37/37 after five fixes, all five real defects (journal 0006) |
| M5 | B4+B6+B7 | Persistent harness; settle B6; score `chromium`; compare profiles | **expected after repair** — 31/39 on first run, 39/39 after four fixes, all four real defects, one fix backed out for producing a false `unchanged` under `jsdom` (journal 0007) |
| M6 | B8 | Stop rinsing; detect and attribute cross-pollution | **expected** — 3.5× faster; found that `:root` tokens never reached any subject under jsdom, so the token band was inert on the cheap tier (journal 0008) |
| M7 | B9 | Separate reflow from repaint; component roles; cross-subject docket | **expected** — see journal 0009 |
| M8 | B10 | Intent, policy, adjudication (spec §7.2); ADR-0010's two environment keys | **expected** — `rebrand` and `rebrand-with-accident` change the same 14 screenshots and adjudicate differently |
| M9 | B10 | `locate` and `source` — landmark orientation, component→file by reading the repo | **expected** — `_debugSource` is gone in React 19, so per-element source is a plugin story nothing tells |
| M10 | B11 | Raster phases, durable/ephemeral retention (ADR-0011), MCP surface | **mixed** — the offload works and the ranking did not; area measures displacement, so the ordering now comes from the semantic tier (journal 0013) |

---

## Open links

- **Band cardinality — a policy decision, no longer a modelling gap.** Under
  `chromium` every `token`-band change that alters a component's size is reported
  as `geometry`, because `dominantBand` returns the worst band present (4 cases,
  journal 0007), so a project blocking on `geometry` blocks on every padding
  change. B9 supplies the missing distinction as a second axis rather than by
  changing the bands: `impact` says whether a change can *move* anything, so
  "spacing token" is now `band: token, impact: layout` and "colour token" is
  `band: token, impact: paint`. What remains open is which of the two a policy
  should gate on — that is spec §7.2's business, not the differ's.
- **Profile skip order** (ADR-0002). Measured: a warm `chromium` capture is 7.5 ms,
  not the ~100 ms the ADR's tier table assumed. The gap between the two semantic
  tiers is ~5×, not ~100×, so "skip chromium on a jsdom hit" buys much less than
  the table implies. Still undecided, now with a number.
- **`dialog-open/dialog`** is the only remaining contested case: the subject
  boundary for portalled content is a real open question, not a per-profile one.
- **One machine.** Every rect and the 27× ratio come from one mac, one Chromium.
  Fonts enter the environment key as a caller-supplied string rather than a
  content hash, so a second machine could render different geometry and the key
  would not say so.
- **Corpus validity beyond ourselves.** One corpus, built by us. Both profiles now
  agree on it, which proves the two collection paths implement one ruleset. It
  does not prove the ruleset holds on someone else's component library. Sharpened
  by journal 0008: the corpus applies token overrides *inline on the subject
  root*, which routed around a hole where `:root` tokens reached nothing — a
  fixture convenient in the same way the implementation was convenient tested
  nothing.
- **Module-level state is outside the session probe.** A singleton store or
  cached client cannot be seen. Confirmation catches the symptom; attribution
  correctly reports no culprit.
- **The docket has never seen a real change set.** `buildDocket` aggregates roots
  across subjects and is tested on constructed diffs. No repository has been run
  through it, so "one token, 300 collateral, one action" is demonstrated at 3
  subjects, not 300.
- **Ranking rests on one measurement.** `rankRegions` fixes an ordering that area
  gets backwards, on one mutation and one story. The finding is solid; the
  generality is not measured.
- **The acquired document is not proven faithful.** It paints something with the
  subject's geometry that responds to its styling, over a socket, byte-identically
  — which is enough to offload and is not the same claim as "the image matches the
  page it was acquired from".
- **The MCP layer has never served a real agent.** Four tools shaped by argument
  about what an agent needs, tested against text rather than against use.
- **The font probe reports metric-compatible substitutes as missing.** A false
  alarm rather than a false `unchanged`, and the same hole as "one machine".

---

## Next

The raster stage landed, so the open question moved. What is unmeasured now is
**generality**: one corpus, one mutation behind the ranking, one machine behind
every ratio, and an MCP surface nothing has used. The cheapest thing that would
move any of those is running the whole chain over a repository that is not ours.

**Band cardinality** remains where B9 left it — a policy decision about which
axis to gate on, not a modelling gap.
