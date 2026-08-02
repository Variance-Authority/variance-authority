# Epitaphs

Append-only. Never rewritten, never pruned, never reloaded — consulted only when
expanding, to stop a dead branch returning under a new name.

Each entry: the branch, the result that killed it, and the condition that would
justify a retry.

---

## History as a local file, with a pixel payload

**Retired:** 2026-08-02, before landing. Built as `packages/history` — an
append-only JSONL ledger accumulating `changedPixels` per subject per run — and
removed the same day.

**What killed it, in two independent ways.**

*The payload.* The end-to-end refuted it inside an hour: a **1px** change to
`--va-space-3` produced **4949 changed pixels**, because the count is dominated
by how much page sits below the edit. It measures displacement, not drift — the
same defect `rankRegions` exists to fix (journal 0013), compounded over time
instead of over one image. It is also machine-bound, so accumulating it across
runs breaks the rule ADR-0011 exists to enforce.

*The location.* A local file makes derived state a human merge problem, and the
hashes of a merge commit are neither branch's — so a committed record always
describes a state that no longer exists by the time it lands. An append-only
JSONL adds interleaved writes from concurrent CI jobs on top.

**Replaced by** specs 0001 and 0002: semantic band hashes per component boundary plus
resolved token values, in an external service that stores observations rather
than state, and therefore has no merges to resolve.

**What would justify a retry.** Nothing for the pixel payload — it is wrong for a
measured reason, not a circumstantial one. The *local file* could return only for
a single-developer, single-branch use where no merge exists, and that is not the
case this project is for.

