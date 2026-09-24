# Spec 0070 — a change says what its tests moved

**Missing:** a comparison of two records. `covering --since` answers about the
lines a change touched: which cases walk them. It says nothing about the lines a
change did *not* touch, and that is where a change to a test does its work. A
test that stops entering a function regresses the function's coverage, and the
function's file is not in the diff, so no reviewer is shown it. Nothing in
`packages/sense/src/test-selection` compares two snapshots or two case indexes:
`deviation.ts` and `divergence.ts` both read one.
**Built on:** [0069](0069-the-case-index-layers-each-run.md) (a case index that
holds the whole suite, and the layer a run retired),
[0067](0067-a-case-carries-its-outcome.md) (a region a stopped case did not
reach is a hole, not a loss), and the review formats of
[0066](0066-the-record-on-a-bitbucket-pull-request.md).

## Purpose

There are two kinds of change, and a review sees only one:

- **A change to code.** Its lines are in the diff, and `covering --since` puts
  their cases beside them. This is built.
- **A change to a test, or to what tests reach.** A test gains an assertion
  path, loses a branch through a refactor, or is deleted, and the regions it
  moved are in files the diff does not name. Code that moves an early return
  does the same to everything below it. Nothing shows this today.

The second kind is only visible as a difference between two runs: the base's
and this one. So this spec compares records, region by region, and reports what
moved, not what is.

## What would discharge it

**1. Two records, each naming its commit.** `covering --since <ref> --against
<record>` reads a second recording: the base. On a pull request the base is the
recording `main` made, restored from the pipeline's cache into its own
directory *before* the run layers onto it. Locally, the base is the layer 0069
keeps of the cases a run retired. The comparison is honest about its base:

- The base's commit is stated. When it is not the merge base, the files `main`
  changed between the two are left out and named, because their motion is
  `main`'s and not this change's.
- A base missing in CI is refused with the step that restores it, and a base
  missing locally is the previous layer (0069 item 3).

**2. What moved, per region.** Regions are matched by address and kind, as 0069
item 2 matches them. For each one, the cases that entered it at each end give
one of these:

- **Lost:** walked at the base, and no case enters it now. Every case that could
  have reached it finished, so it is a real regression.
- **Hidden:** walked at the base, and no case enters it now, but a case that
  could have reached it stopped. It is a hole, and the case is named. It is not
  called a regression.
- **Thinned:** entered by several cases at the base and by one now.
- **Gained:** no case entered it at the base, and one does now.

Walked regions that stayed walked are not reported. The count of each kind is
stated, and "no region moved" is said in those words, because an empty section
and a comparison that was not made are different answers.

**3. Motion anchored where the reviewer is.** The regions a change moved are
mostly in files outside the diff, and a host draws inline only on the diff. So
each change to a test file is also reported *on the test file*, which is in the
diff: "this file now enters 14 regions it did not, and no longer enters 3", with
the regions listed. A lost region in an untouched file is annotated on its own
lines as well. GitHub and Bitbucket both list an annotation outside the diff on
the check or report, not beside the code. The `markdown` format carries every
moved region in its own section.

**4. The same question from a shell.** `covering --since <ref> --against
<record>` in `text` and `json` answers the same thing, so an agent can ask it
before pushing. The editors paint a lost region in its own mark (0063 item 6).

## Acceptance

1. A pull request whose only change is a test that stops calling one function
   reports that function as **lost**, on the test file and on the function.
2. The same pull request with the test failing reports it as **hidden**, and
   names the case.
3. A pull request that changes no test and no reach says that no region moved.
4. A base recorded three commits behind the merge base names the files `main`
   changed since, and reports no motion in them.
