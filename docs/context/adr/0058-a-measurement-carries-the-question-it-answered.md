# ADR-0058 — a measurement carries the question it answered

**Status:** accepted
**Date:** 2026-09-13
**Extends:** ADR-0004 (defer native acceleration behind a measured gate)
**Relates to:** [journal 0044](../journal/0044-the-codec-was-chosen-before-the-floor-moved.md)

## Context

ADR-0004 settled whether a workload may be rewritten in another language, and it
settled it well: a gate with a threshold, and no native code until one fires. It
does not govern the far more common question, which is not *should this be
native* but *which of two slower-or-smaller is the one to take*. The record path
asks that continuously — a compression level, a run size, a cache depth — and
until now it was argued from whatever number the record happened to carry.

[`docs/execution-record.md`](../../execution-record.md) carried this one for
several weeks:

> zstd costs about three per cent more bytes

That was measured, on real data, with a reproducible command, and as a decision
input it was wrong. The snapshot's runs are two kinds of data — a varint run is a
dense stream of small integers, and a run of the string blob is file paths and
hex digests — and a codec level is per call, not per format. Level 6 is right for
the varints and level 1 is right for the blob, which finds nothing above it and
gets *larger*. One level across both averaged two populations into a loss, and
the number that came back was true of neither. Taking the trade properly is 319
milliseconds of compression down to 120 and a file 86 kilobytes smaller, against
the brotli it replaced — better on every axis at once.

The number was not a lie and re-running it would not have caught it. What was
missing is that it did not carry its own question, so nothing about it announced
which premise it depended on, and it outlived that premise silently.

## Decision

**A recorded performance number states the question it answered. A number
without its question is a rumour with a command attached.**

Rule 4 of [the context README](../README.md) requires a reproduction. This adds
the other half: the premises the measurement held fixed, written where the number
is, because those are what expire.

Four rules follow from it, and each one is a mistake this repository has made.

**Name the axes before taking the number.** A record-path change moves as many as
four things: writer time, reader time, bytes, and the runtime floor. A change
that moves one against another is a trade and needs an argument. A change that
moves all of them the same way is not a trade at all and needs only a floor
check — which is what zstd turned out to be, and why it was easy the moment the
question was right.

**An axis is ranked by who pays it and how often, not by its size.** Writer time
is paid once, by one machine, at the end of a run. Bytes are paid by every reader
that fetches the artifact, forever, and again by `va share`. This is what settled
the brotli-quality question: decompression measured the same at every quality —
871 to 933 ms across the whole sweep — so lowering quality was purely writer time
bought with bytes every reader carries. A smaller number on the axis one machine
pays does not outrank a larger one on the axis everybody pays.

**A knob applied across populations reports their average, which may be true of
nothing.** Before tuning one, establish that the data under it is one kind. When
it is not, the knob is per kind, and a single value for it is a finding about
arithmetic rather than about the workload.

**Sweep, do not extrapolate.** Brotli quality 4 is a genuine local minimum here:
5, 6 and 9 each measured *larger* on this data. A curve assumed from two points
is not a curve.

## What this forecloses

- **A single-number comparison of two codecs, levels or parameters entering the
  record.** If the data has kinds, the comparison has rows.
- **Quoting a recorded number as a decision without re-reading its premises.** A
  number in the journal is evidence about the conditions it was taken under. When
  a premise has moved — a runtime version, a data layout, a call site — the
  number is unrefuted and inapplicable at the same time, and those are not the
  same as still true.
- **Optimizing the axis that is easiest to measure.** Writer time is the one a
  script reports without being asked, and it is usually the cheapest axis in the
  system.

It does not foreclose being wrong. Journal entries are append-only and a
measurement may be superseded; what this requires is that the entry say enough
for a later reader to notice that it should be.
