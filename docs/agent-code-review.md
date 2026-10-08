# Review a change against what the code did

A review has the diff, and the diff is the one thing that cannot show whether
the changed lines are watched. Two readings answer that from the same change
set: the [execution record](execution-record.md) records which named cases
covered each changed region, and composition counts how many of the subjects
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
module row — the run instruments what the tests import, not the tests themselves
— so it is answered with the named cases it declares. For a changed path the
index holds nothing for, the answer prints exactly that. And a missing index is
refused rather than answered empty, because an empty list here reads as *no test
covers this line*, which is the sentence that gets a test deleted.

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
   changed regions, and the regions standing on nothing. When a bot reviews the
   pull request, `variance review --format handover` puts a short form of this
   reading in its body (below).
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

## Hand the first reading to a review bot

A review bot starts when the pull request opens and reads its body, before CI
has run the suite. It cannot read the comment CI posts later. Give it the first
reading in the body instead. You run this when you open the pull request, and
paste its output under what you wrote; an agent appends it to the file it
passes to `gh pr create --body-file`:

```bash
variance review --since origin/main --format handover
```

```markdown
<!-- variance-authority: handover -->
<details><summary>🧭 Coverage of the changed area: 4 changed functions, 1 with code the record holds no case for, 1 new and not run yet</summary>

Read from the record of `unit` before this change ran.

- 🔴 `applyCoupon` in `src/cart.ts` — a part the record holds no case for; the rest 3 cases, near: `test/cart.test.ts`
- 🔵 `roundTotal` in `src/cart.ts` — new, not run yet
- 🟡 `checkout` in `src/checkout.ts` — 2 cases, far: `test/flows/checkout.test.ts`

And 1 more, every one reached by a case: 1 near.

More on one file: `variance covering --since 3f2a9c0d1e4b --file <path>`
</details>
<!-- /variance-authority: handover -->
```

It hands over where to look, not the review. A changed function gets a line
when there is something to look at: 🔴 means part of it ran under no case, or
has no case in a record from before the change, 🔵 that the change wrote it and
no case has run it yet. The other marks are the review comment's, for the
furthest part a case reached: 🟡 from far, 🟠 from a distance not measured, ⚪
only while its module loaded. The line names how many cases and the test file
to open. *Near* means a case came from a test file that imports the changed
file. *Far* means every case came from further away, through other modules;
see [test distance](distance.md). A function every case reached from near is
only counted: a test file that imports it is easy to find. Functions with code
no case ran come first. Past twelve lines the rest are only counted, so the
block stays a handful of lines on a change of any size, and its last line is
the `covering` command that reads one file in full.

A person sees one collapsed line. A bot reads the raw body, folded content
included. The markers show where the block a later run prints is pasted, so
the body never carries two. Every suite in your configuration's `suites` is
read, and when there is more than one a line names the suite its reading came
from. A suite whose record cannot be read gets one line saying why; the suite
named with `--suite` fails instead.

It reads the record `covering` reads: the one `withTestSelection` writes when
a suite runs in your checkout or, where your checkout has none, the mainline's
that CI publishes to a [share](sharing.md), once fetched. Before CI has run,
that record is older than the change, and the block says so under its summary.
That is the case *Record before you review* warns about, made safe the same
way: the record names the commit it was made at, and the changed lines are
paired with it through the diff from that commit, not read as if they had not
moved. So a line says which cases stood on the function before the change,
which is the right place to start reading, and code the change wrote shows as
*new, not run yet* rather than as uncovered. A suite you ran on the change
answers alone for every file it read, since an older record's cases reached
the old code; where the block reads both, the summary counts what only an
older record reached, and its lines say *in the record*. What CI's run did
arrives later as its own comment.

## What none of it decides

Execution records which code a case ran, never why the case needed it, so three
cases on one region raise the question *why do all three need this code* and do
not answer it. Composition shows that two subjects contain the same bytes, not
that one of them is redundant. Neither reading approves a change, and neither
produces a number you can put a threshold on: a region with no witness is a
place to look, and how much it matters is yours.

The full command reference is in the [CLI
package](../packages/cli/README.md#covering-which-tests-covered-this-line); the
MCP tool contracts are in the [MCP
package](../packages/mcp/README.md). [Everything an agent can
ask](agent-questions.md) routes the questions this page does not.
