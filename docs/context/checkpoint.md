# Helix checkpoint

**Surface:** this file (git-committed). Epitaphs: [`epitaphs.md`](epitaphs.md).
**Cycle:** 2
**Reload budget:** one read. Verdicts only — no deliberation, no candidate lists.

---

## Outcome

M0 spike answers its exit question: **is normalization quality achievable?**

A semantic snapshot pipeline produces stable, attributed, content-addressed
hashes for a subject rendered under two observation profiles (`jsdom`,
`chromium`), on a corpus we control.

**Proof.** On our own corpus, all four hold:

| # | Claim | Measured by | State |
|---|---|---|---|
| P1 | A no-op refactor does not change the hash | hashed-class churn, `useId` renumbering, non-semantic wrapper insertion, unrelated-CSS growth | partial — first three proven on fixtures; **unrelated-CSS growth unproven**, it needs a collector |
| P2 | A real change produces exactly one root plus counted collateral | one token edit reaching many subjects | half — `structureHash` holds while `styleHash` moves, and token names group collateral; **no differ exists to emit the roots** |
| P3 | Owner chains resolve to component display names | fiber walk over the corpus | pending B2 |
| P4 | Both profiles agree on the dimensions both can observe | jsdom vs chromium on the shared subset | pending B4 |

**Boundary.** M0 only. Excluded: raster stage, CLI ergonomics, GitHub Action,
MCP server, cross-repo `inherited`, hosted anything. No push, no publish.

---

## Branches

| id | Branch | State |
|---|---|---|
| B1 | **normalizer** — cruft removal, cascade, canonical hash | landed for the in-`core` half; applicability pruning moved to B4, where the DOM is |
| B2 | **provenance** — React fiber owner chains + props digest | in flight (worktree) |
| B3 | **corpus** — controlled example library with deliberate cruft | in flight (worktree) |
| B4 | **dual-surface** — jsdom and chromium collectors emitting one format | not started; now also owns CSS applicability pruning |
| B5 | **differ** — semantic diff, delta banding, root/collateral attribution | admitted this cycle; P2 cannot close without it |

---

## Moves

| id | Branch | Move | Expected readback | Disconfirming readback | Result |
|---|---|---|---|---|---|
| M1 | — | Scaffold monorepo, ADRs 0001–0003, `core` types | Packages typecheck; `core` has no DOM types available | `core` cannot express a snapshot without DOM types | **expected** — compiles with `lib: ES2022` + node only; React detected structurally via `$$typeof`, no framework dependency needed |
| M2 | B1 | Implement the normalization pipeline | ADR-0003 no-op refactors hash identically; negative controls do not | A rule cannot be stated without dropping a value from the hash or over-collapsing two different renders | **mixed** — 67/67 pass, but ADR-0003 step 4 was wrong: literal application drops `font`/`background` entirely. Amended to all-or-nothing expansion (see journal 0004) |
| M3 | B4 | Collector emitting `RawCapture` from a real DOM, including applicability pruning | Accreted unrelated CSS leaves the hash unchanged | Pruning cannot be made engine-independent, so the two profiles need different rules | *pending* |

---

## Open links

- **Profile skip order** (ADR-0002): does a `chromium` hit permit skipping
  `jsdom`, or only the reverse? Undecided until P4 is measured.
- **Props digest stability** (spec §11.2): resolved toward shape in `core`;
  B2 must confirm it behaves on real fiber props, which is where non-serializable
  values actually appear.
- **P1's fourth case has no owner until B4 lands.** The headline claim of
  ADR-0003 — that accreted Storybook and CSS-in-JS noise invalidates nothing —
  is currently *unproven*, not merely untested. It must not be stated as fact
  anywhere until a collector demonstrates it.

---

## Next

**M3** — the collector boundary (B4). It owns the one unproven half of P1 and
unblocks P4. B5 (differ) follows, because P2 cannot close without it.
