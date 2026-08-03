# Spec 0007 — Linux verification

**Status:** `not built` — see [the status vocabulary](README.md#status-vocabulary)
**Depends on:** [0003](0003-cli.md)

## Purpose

Every measurement in this repository comes from one Mac and one Chromium. The
claim that this runs in any Linux terminal is stated and unverified, and several
design decisions rest on numbers that have only ever been taken on one machine.

## Contract

Run the full suite and both corpus measurements on Linux, and record the results
next to the existing ones rather than replacing them.

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
