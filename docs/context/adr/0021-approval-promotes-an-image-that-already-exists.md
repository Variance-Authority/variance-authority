# ADR-0021 — Approval promotes an image that already exists

**Status:** accepted
**Date:** 2026-08-03
**Extends:** ADR-0011 (durable and ephemeral retention), ADR-0016 (where a baseline is kept decides nothing), ADR-0017 (the exit code is the interface)
**Discharges:** spec 0010, review half

## Context

ADR-0019 delivers a finding to a pull request comment and stops there, and its
spec listed a review UI and team approvals as out of scope. That boundary held
while there was nowhere for a review to live: `variance accept` promotes a
candidate on the machine that ran, so a decision exists only where the run
happened, and a team gets it by committing images to a branch.

Giving the decision somewhere to live raises a question `accept` never had to
answer, because a CLI has the run's own output on disk beside it. A review
surface does not. It is a different process, on a different machine, days later,
and the only thing it is certain to have is what somebody uploaded.

There are two ways to build it and they differ in exactly one respect.

**Store the pixels and re-derive the rest.** A build keeps the images, and
approving re-renders the subject to obtain the document digest and the identity a
baseline needs. This is what a surface with a renderer behind it does, and it
reads as obviously correct — the digest it computes is *right*, after all.

**Store what a baseline is, and move it.** A build keeps the candidate's bytes
*and* the digest it was painted from *and* the identity that painted it, and
approving writes those three through the store unchanged.

The first is the one to refuse, and the reason is not efficiency. A baseline is
not an image; it is an image plus the document it was painted from and the
machine that painted it — that pair is the sidecar the cheap `describe` path
answers from without moving a byte, and it is what makes `incomparable` possible
at all. A surface that can produce those fields is a surface that can **render**,
and a surface that can render can record a baseline **nobody ever looked at**:
the reviewer approves the image on their screen, and the bytes that land are the
ones a second render produced from a document that may no longer be the one they
saw. It is `accept --all` with a human in front of it, which
ADR-0017 already names as the mode where a gate becomes a recorder.

## Decision

**Approving promotes an artifact the run already produced. Nothing in the review
path renders, measures, or defaults any field of a baseline.**

- A build stores, per subject, the candidate's `documentDigest`, `width`,
  `height` and `missingFonts` alongside the object key — the columns exist for no
  other purpose.
- Approval reads those, fetches the bytes, and calls `RasterStore.put`. The same
  store a run reads, the same identity partition, the same checks.
- **A subject whose candidate was not uploaded cannot be approved.** It is
  refused with the reason, not filled in.

Three rules follow from the same argument.

**Promotion happens before the decision is recorded.** The other order can leave
an approval on the page whose baseline was never written, and the next run then
reports the same change again with the reviewer's name already against it — the
one failure mode where the record and the artifact disagree and the record is the
thing people trust.

**A decision is a row, not a field.** Approving and then changing one's mind
leaves two rows; the table carries `UPDATE` and `DELETE` triggers like every
other record of a fact about a moment. The earlier decision is what makes the
later one reviewable, and a promoted baseline whose approval was deleted is a
change nobody can attribute to anyone.

**Retention expires what was kept to be looked at, and nothing else.** A sweep
removes builds, their subject rows and their images. It does not remove promoted
baselines — which are what the next run compares against — and it does not remove
decisions. It reports counts for everything it did remove, because a store that
discards quietly is a store whose "we have never seen this" is a lie, and `new`
re-records.

## Consequences

**A run that keeps no images produces a build nobody can approve**, and the
surface says so on the button rather than failing when it is pressed. That is the
intended shape: the fix is to upload the candidate, not to let the server invent
one.

**The review path cannot distinguish two images of one subject.** `RunReport`'s
`ObservationRecord` carries a subject and no label, so `build_subjects` has no
label column while `baselines` does. Labelled baselines are writable through the
store and unreachable through review. The day a run reports labels, the table
grows a column and the promotion path stops passing an implicit one.

**The docket, not the comparison, is what the surface leads with.** Having
decided that the interesting artifact is the *observation* rather than the
pixels, the ordering follows: causes with their files first, collateral counted,
region boxes over the render, and the before/after comparison last. Ranked by
area the same report is backwards — a container that only reflowed outranks the
edit by 6× (journal 0013) — so a surface that opened on two screenshots would be
presenting the ordering this project measured as wrong.

**Region boxes are placed from dimensions the build carries**, not from an
image measured in the browser. A box positioned after load is a box in the wrong
place for one frame, and a box in the wrong place attributes a change to whatever
it lands on.

**None of this has run against Cloudflare.** The promotion path, the refusals and
the retention sweep are verified against real SQL through `node:sqlite` and an
in-memory bucket; the platform is not. That is an open link in the checkpoint,
not a property of this decision.
