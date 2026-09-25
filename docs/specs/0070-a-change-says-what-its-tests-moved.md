# Spec 0070 — a change says what its tests moved

**Missing:** what moved, shown where the reviewer reads. `covering --since
<ref> --against <record>` compares two case indexes region by region and names
each region lost, hidden, thinned or gained, in `text` and `json`. The code
host formats refuse `--against`, no pipeline step restores the base, and no
editor marks a lost region.
**Built on:** [0069](0069-the-case-index-layers-each-run.md) (a case index that
holds the whole suite), [0067](0067-a-case-carries-its-outcome.md) (a region a
stopped case did not reach is a hole, not a loss), and the review formats of
[0066](0066-the-record-on-a-bitbucket-pull-request.md).

## Purpose

A change to a test moves regions in files the diff does not name. The
comparison exists. A reviewer on a pull request does not see it, because the
host draws inline only on the diff and the review formats carry only the
changed lines.

## What would discharge it

**1. The base in the pipeline.** The CI step restores the recording `main` made
from the pipeline's cache into its own directory *before* the run layers onto
its own, and passes its case index as `--against`. A base missing there is
refused with the step that restores it.

**2. Motion anchored where the reviewer is.** Each change to a test file is
reported *on the test file*, which is in the diff: "this file now enters 14
regions it did not, and no longer enters 3", with the regions listed. A lost
region in an untouched file is annotated on its own lines as well. GitHub and
Bitbucket both list an annotation outside the diff on the check or report, not
beside the code. The `markdown` format carries every moved region in its own
section.

**3. A lost region in the editor.** The editors paint a lost region in its own
mark (0063 item 6).

## Acceptance

1. A pull request whose only change is a test that stops calling one function
   reports that function as **lost**, on the test file and on the function.
2. The same pull request with the test failing reports it as **hidden**, and
   names the case.
