# Helix checkpoint

**Surface:** this file (git-committed). Epitaphs: [`epitaphs.md`](epitaphs.md).
**Cycle:** 1
**Reload budget:** one read. Verdicts only — no deliberation, no candidate lists.

---

## Outcome

M0 spike answers its exit question: **is normalization quality achievable?**

A semantic snapshot pipeline produces stable, attributed, content-addressed
hashes for a subject rendered under two observation profiles (`jsdom`,
`chromium`), on a corpus we control.

**Proof.** On our own corpus, all four hold:

| # | Claim | Measured by |
|---|---|---|
| P1 | A no-op refactor does not change the hash | hashed-class churn, `useId` renumbering, non-semantic wrapper insertion, unrelated-CSS growth |
| P2 | A real change produces exactly one root plus counted collateral | one token edit reaching many subjects |
| P3 | Owner chains resolve to component display names | fiber walk over the corpus |
| P4 | Both profiles agree on the dimensions both can observe | jsdom vs chromium on the shared subset |

**Boundary.** M0 only. Excluded: raster stage, CLI ergonomics, GitHub Action,
MCP server, cross-repo `inherited`, hosted anything. No push, no publish.

---

## Branches

| id | Branch | State |
|---|---|---|
| B1 | **normalizer** — cruft removal, CSS applicability pruning, canonical hash (ADR-0003) | active |
| B2 | **provenance** — React fiber owner chains + props digest | active |
| B3 | **corpus** — controlled example library carrying deliberate cruft + no-op refactor variants | active |
| B4 | **dual-surface** — jsdom and chromium collectors emitting one format (ADR-0002) | active |

---

## Moves

| id | Branch | Move | Expected readback | Disconfirming readback | Result |
|---|---|---|---|---|---|
| M1 | — | Scaffold monorepo, ADRs 0001–0003, `core` types | Packages typecheck; `core` has no DOM types available | `core` cannot express a snapshot without DOM types | *pending* |

---

## Open links

- **Profile skip order** (raised by ADR-0002): does a `chromium` hit permit
  skipping `jsdom`, or only the reverse? Undecided until P4 is measured.
- **Props digest stability** (spec §11.2): non-serializable props need a digest
  that neither over- nor under-invalidates. No branch owns this yet.

---

## Next

**M1** — scaffold and `core` types. Blocks B1–B4, all of which need the format.
