# Spec 0007 — Linux verification

**Status:** `built, never run` — see [the status vocabulary](README.md#status-vocabulary)
**Depends on:** [0003](0003-cli.md)

## Purpose

Every measurement in this repository comes from one Mac and one Chromium. The
claim that this runs in any Linux terminal is stated and unverified, and several
design decisions rest on numbers that have only ever been taken on one machine.

## Contract

Run the full suite and both corpus measurements on Linux, and record the results
next to the existing ones rather than replacing them.

[`docker/linux-verify.Dockerfile`](../../docker/linux-verify.Dockerfile) and
[`docker/linux-verify.sh`](../../docker/linux-verify.sh) are that, and neither
has been executed once. This spec said `not built` until 2026-08-03, which is why
nobody ran them: the index said the work had not started.

**And they could not have run this contract.** The image copied `packages`,
`examples` and four config files. `cases/*` is a declared workspace, so
`yarn install --immutable` fails without it — masked by an `|| yarn install`
fallback that would have produced an image with a *different dependency set* and
then compared its numbers to the macOS ones as though the only difference were
the platform. `tools/**` is in the vitest include, so this repository's own
boundary and documentation rules would not have been among the tests. Neither
absence shows up in a summary: a suite that never collects a file reports one
fewer file, and nobody counts. All three are fixed, `.dockerignore` now keeps a
macOS `node_modules` out of the machine that exists to be a different one, and
`linux-verify.sh` refuses a run whose log does not name the families that went
missing.

## Behaviour

**Semantic results MUST match across platforms.** ADR-0010 asserts that the
semantic representation is portable because machine-bound inputs cannot reach the
box tree. Two platforms producing different semantic verdicts refutes that, and
the refutation is more valuable than the confirmation.

**Raster results are expected to differ**, and MUST report `incomparable` rather
than a diff when a Linux baseline meets a macOS run. This is the case ADR-0011
was designed for and it has never been exercised with two real machines.

**The font probe is expected to misreport.** A Linux container ships
metric-compatible substitutes precisely so layout does not move; the probe reads
them as missing. Measure the false-alarm rate rather than assuming it.

## Acceptance

1. Both corpus measurements produce identical verdicts on Linux and macOS —
   38/38 under `jsdom`, 39/39 under `chromium`, zero false verdicts.
2. A durable baseline written on one platform and read on the other reports
   `incomparable`, naming both machines.
3. The cost ratios are re-measured on Linux and recorded. Where they differ
   materially from the macOS numbers, the documents citing those numbers are
   corrected.
4. The font probe's false-alarm rate on a standard Linux container image is
   measured and stated.

## Out of scope

- Windows.
- Browsers other than Chromium.
