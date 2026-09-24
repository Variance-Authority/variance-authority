# Spec 0066 — the record on a Bitbucket pull request

**Missing:** the facts a Bitbucket pull request cannot carry yet, and the proof
that it shows the ones it can. `variance covering --since <ref> --format
bitbucket-report` and `--format bitbucket-annotations` put a change's regions
on the pull request as a Code Insights report with its annotations:
holes, regions nothing entered, and regions one case alone entered. The
pipeline posts them through the proxy, as `packages/cli/README.md` shows.
What is not there: failing cases, parted regions and components, and a run on a
real pull request.
**Built on:** `coveringChange` in `packages/sense/src/test-selection/reverse.ts`
(the reading), `formatReview` in `packages/cli/src/commands/covering-review.ts`
(the bodies), [ADR-0019](../context/adr/0019-one-comment-that-leads-with-causes.md)
(the comment the forge already carries),
[ADR-0017](../context/adr/0017-the-exit-code-is-the-interface.md) (the gate),
[0016](0016-ci-that-has-run.md) (the Bitbucket recipe has never run),
[0067](0067-a-case-carries-its-outcome.md) (outcomes).

## Purpose

Bitbucket Cloud offers an integration exactly one way to mark a line: a **Code
Insights** report on a commit, with annotations that carry a path and a line.
No Forge or Connect module draws in the gutter of the source view or the diff.
`repositoryCodeFileViewer` replaces the whole file view. Connect loses support
on 31 January 2027. So the line-level surface is Code Insights, and this spec is
about putting the record there without it claiming more than the record holds.

It does not fit exactly, in three places:

- **Annotation types are fixed.** They are `VULNERABILITY`, `CODE_SMELL` and
  `BUG`. A hole is none of these. `CODE_SMELL` is the least false of the three,
  and the annotation's summary says what the finding actually is.
- **Severity is a ranking the record holds only once.** A hole is `MEDIUM`
  and everything else is `LOW`. A hole is the one finding the diff cannot
  show: a case stopped before it could be seen reaching the region. The other
  states are not ranked against each other.
- **The report offers `PERCENTAGE`.** That type is not used. The report's data
  is counts.

## What would discharge it

**1. The report states the change's outcome.** The report carries changed
regions, holes, regions nothing entered, regions one case entered alone, changed
files the record does not hold, and the recorded commit. It still lacks *cases
the change reaches, and how many failed*. That count needs the selection and
0067.

**2. An annotation per fact on a changed line, in the head commit's lines.**
The annotations are the reader's facets
([0063](0063-an-editor-asks-about-the-text-it-holds.md)) for the commit, read
through the one-shot command. Each is placed only where the diff changed a
line. Rows three and four are built, with holes split from the regions every
case finished without entering. The rest are not:

| fact | `annotation_type` | `result` | summary |
|---|---|---|---|
| a failing case's top frame (0067) | `BUG` | `FAILED` | the case and its message |
| a changed region walked by a failing case | `BUG` | `FAILED` | the failing cases |
| a changed region no case walked | `CODE_SMELL` | none | *no recorded test walked this* |
| a changed region one case alone walked | `CODE_SMELL` | none | the witness |
| a changed region where observers parted | `CODE_SMELL` | none | how many entered and how many missed |
| a component declared on a changed line whose subject changed | `CODE_SMELL` | none | verdict, pixels, standing, and a `link` to the report |

Each annotation names its cases and links to the report when there is one. The
lines have to be the head commit's lines. Today a record not made on that
commit is refused. A record carried from the target branch would go through the
frame check that `covering --file --text` already makes. A fact whose text the
check cannot place is left out, and the report counts it. It is never put on a
guessed line.

**3. Bitbucket shows it.** Bitbucket Data Center annotates only lines inside the
diff, and it is not documented whether Cloud does the same. A run on a real pull
request settles it. That run is the one [0016](0016-ci-that-has-run.md) is
already missing, and this spec adds a second artifact to it.

## Chart finding

`.compass/externals/code-forge.md` says that nothing crosses to the forge except
the comment and the exit code. A Code Insights report is a second crossing. That
is a change to the chart, and making it is a Create task under the `compass`
skill. It is recorded here and has not been made.

## What it deliberately does not do

It does not build a file viewer. A Forge `repositoryCodeFileViewer` could show
every range of a file at any commit, but it would need the record. The record is
not in git, and a Forge function can only reach it if it lives somewhere with an
address. That somewhere is `tribunal` ([0021](0021-tribunal-on-a-real-deployment.md)).
It waits for 0021, and a spec of its own follows it.
