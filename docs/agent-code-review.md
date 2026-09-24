# Review a change against what the code did

A review has the diff, and the diff is the one thing that cannot say whether
the changed lines are watched. Two readings answer that from the same change
set: the [execution record](execution-record.md) says which named cases
covered each changed region, and composition says how many of the subjects
it affected are one decision. Both join a change set against what a run
recorded at **one revision**, with no baseline anywhere in them, which is why
an agent holding a patch can ask both before it forms an opinion.

## What a review is asked, and what a diff can answer

You are asked whether the change is safe to merge. A diff states what changed
and can state nothing about what depended on it, so you close the gap by
reading the surrounding code and judging whether it looks watched. That is a
guess about a fact — and the fact was recorded, by running the suite, an hour
ago. Three parts of the gap are worth naming separately, because each one fails
in a different direction.

**A changed region nothing covered looks like every other changed region.**
Usually better: the branch with no test behind it is the short one, three lines
in an `else`, and it reads as obviously correct because there is so little of
it to be wrong. A coverage percentage does not close this. It is a union over
the whole suite, so two files at 94% differ by *which* 6%, and the 6% you are
about to change is exactly the part the number does not break out. What gets
approved this way is not code somebody decided was low risk; it is code nobody
knew was unwatched.

**A region one case covered and a region fourteen cases covered report
identically.** They are different facts. A single witness is very often the
case that was written from the implementation it covers — the code and its test
are one artifact, and an edit that moves both keeps them agreeing with each
other about something that was never checked against intent. Fourteen cases
across nine files is an independent constraint: break it and you are told
immediately, in a form somebody else can read. You have a fixed amount of
attention for a review, and without the count you spread it evenly over lines
that deserve it very unevenly.

**The number of changes in a report is not the number of decisions in it.**
Review effort is paid per finding; risk lives per decision. Eleven affected
subjects are frequently one component edited once, which means ten of those
readings buy nothing — and the attention they consumed is gone by the time you
reach the subject where that same component was expected to move and did not.
Grouping is not a convenience here. It is what makes the exception visible at
all.

Both readings work on a single revision. That matters at review time more than
it sounds: a branch you have been handed usually has no accepted baseline,
nothing of it has been through the pipeline yet, and a comparison against a
previous revision would answer a question you are not asking — you already know
what changed, you are holding the diff. What you do not have is what the code
*did*. The record and the run both answer that from the commit in front of you,
which is why an agent can ask them the moment a patch exists rather than after
somebody accepts something.

## Ask the record what covered the change

```bash
variance covering --since main
```

```text
2 changed files since main, 5 changed regions: 1 nothing covered, 2 covered by one case.

src/checkout/total.ts
  41-60 function applyDiscount — 3 cases
    applies a percentage discount — src/checkout/total.test.ts [total.test.ts::applies a percentage discount]
  62-66 branch applyDiscount — no case covered this region
```

The two counts in the first line are the findings. A region **no case covered**
is the hole; a region **one case alone covered** is the single point. A case
that was inside a region only while its module was evaluating is counted apart
from one that called into it, because being present while a module-scope
constant is built is not exercising the function beneath it.

Three answers that read alike are kept apart. A changed **test file** has no
module row — the run instruments what the tests import, not the tests
themselves — so it is answered with the named cases it declares. A changed path
the index holds nothing for says so in those words. And a missing index is
refused rather than answered empty, because an empty list here reads as *no
test covers this line*, which is the sentence that gets a test deleted.

The diff is measured from the commit the record was written at, not from the
merge base with the ref, because the index spells its line ranges in that
commit's coordinates. Record before you review: an index behind the tree
answers fluently about regions that have moved.

This reading needs [test-level coverage](test-level-coverage.md) — the same
recording with a case axis, which every run wrapped in `withTestSelection`
writes beside the file-grain [record](execution-record.md). The file-grain
record alone answers which test *files* covered a module and cannot name a
case.

Over MCP the same evidence is `variance_changed_tests`, which takes the unified
diff the agent is already holding rather than a ref — nothing in that package
runs git.

## Ask the run which of the changes are one change

When the change updated pixels, the second reading is
[composition](composition.md): the run's subjects compared to each other at
this commit instead of to their baselines.

```bash
variance ask composition
variance ask composition --component Chip
```

For everything affected, composition checks whether an edited file, a moved
token or an edited caller explains it, and stops at the first rule that
matches. Beside each difference it carries **`alsoIn`** — the other subjects
the same component changed in — which is the difference between eleven findings
and one, and **`held`**, the sites of the same component with the same props
that this run did *not* report as changed, which is the control group the
finding stands against. A difference nothing explains is named as a finding
rather than folded in with the rest.

It also names the **echoes**: one rendering that appears in more than one
subject. Two diffs over a shared rendering are one thing to review, and the
narrowest subject among them is where to review it. That changes how a review
is sized rather than what it concludes, which is why it comes last.

## Why these two belong on one page

They are the same shape asked of two axes — the change set you are reviewing,
joined against what one run recorded:

| reading | joins the diff to | answers |
|---|---|---|
| `covering --since` | the regions a suite covered, per named case | whether the changed code is watched, and by how many |
| `composition` | the component boundaries the subjects share | how much of the affected report is one edit, and what explains it |

So they fail independently, and that is the useful part. A change with no
witnesses whose subjects were not affected is unexercised and invisible. A change
with plenty of witnesses whose subjects were all affected for a reason nothing explains
is exercised and still wrong. A review that reads one of them alone cannot tell
those two apart.

## The order an agent asks in

1. [`variance reach`](selecting.md) or `variance select` — what the diff can
   reach, and which test files are worth running for it.
2. `variance covering --since <ref>` — the evidence already standing under the
   changed regions, and the regions standing on nothing.
3. The run itself, over the selected files.
4. `variance ask summary`, then `changes` — what was affected, grouped under the
   distinct changes behind it.
5. `variance ask composition` — which of those are one decision, and what
   explains each.
6. `variance adjudicate --claims <path>` — the edit against the intent you
   declared before reading the diff. Its third answer, *declared and did not
   happen*, is the one no comparison of images produces. Skip it when the
   change is somebody else's.
7. `variance ask changelog` — what acceptance would record, read before
   proposing one.

Steps 1 and 2 need only a record. Steps 3 to 7 need the run.

## What none of it decides

Execution says where a case went, never why the trip was worth taking, so three
cases on one region begins the question *why do all three need this code* and
does not answer it. Composition says two subjects watch the same bytes, not
that one of them is redundant. Neither reading approves a change, and neither
produces a number you can put a threshold on: a region with no witness is a
place to look, and how much it matters is yours.

The full command reference is in the [CLI
package](../packages/cli/README.md#covering-which-tests-covered-this-line); the
MCP tool contracts are in the [MCP
package](../packages/mcp/README.md). [Everything an agent can
ask](agent-questions.md) routes the questions this page does not.
