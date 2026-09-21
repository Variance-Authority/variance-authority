# Review a change against what the code did

A review has the diff, and the diff is the one thing that cannot say whether
the changed lines are watched. Two readings answer that from the same change
set: the execution record says which named cases entered each changed region,
and composition says how many of the subjects that moved are one decision. Both
join a change set against what a run recorded at **one revision**, with no
baseline anywhere in them, which is why an agent holding a patch can ask both
before it forms an opinion.

## What the patch leaves open

Three questions decide whether a change is safe to approve, and none of them is
in the text of the diff:

- **Which changed regions nothing has entered.** A hole in the evidence is not
  visible in a patch, and it is not visible in a coverage percentage either: a
  file at 94% and a file at 94% differ by which 6%.
- **How many witnesses each changed region has.** One case alone entering a
  region is evidence standing on a single point. Ten is a different fact, and a
  line count states neither.
- **How much of a changed report is one edit.** Eleven changed subjects are
  often one component, and a reviewer who does not know that reviews eleven
  things.

## Ask the record what entered the change

```bash
variance covering --since main
```

```text
2 changed files since main, 5 changed regions: 1 nothing entered, 2 entered by one case.

src/checkout/total.ts
  41-60 function applyDiscount — 3 cases
    applies a percentage discount — src/checkout/total.test.ts [total.test.ts::applies a percentage discount]
  62-66 branch applyDiscount — no case entered this region
```

The two counts in the first line are the findings. A region **no case entered**
is the hole; a region **one case alone entered** is the single point. A case
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
recording with a case axis, which is a run wrapped in
`withTestSelection(config, { cases: true })`. Without it you have the
file-grain [record](execution-record.md), which answers which test *files*
entered a module and cannot name a case.

Over MCP the same evidence is `variance_changed_tests`, which takes the unified
diff the agent is already holding rather than a ref — nothing in that package
runs git.

## Ask the run which of the changes are one change

When the change moved pixels, the second reading is
[composition](composition.md): the run's subjects compared to each other at
this commit instead of to their baselines.

```bash
variance ask composition
variance ask composition --component Chip
```

For everything that moved, composition checks whether an edited file, a moved
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

They are the same shape asked of two axes. Both take the change set you are
reviewing, both join it against what a single run recorded, and neither
compares anything to a previous revision:

| reading | joins the diff to | answers |
|---|---|---|
| `covering --since` | the regions a suite entered, per named case | whether the changed code is watched, and by how many |
| `composition` | the component boundaries the subjects share | how much of the moved report is one edit, and what explains it |

So they fail independently, and that is the useful part. A change with no
witnesses whose subjects did not move is unexercised and invisible. A change
with plenty of witnesses whose subjects all moved for a reason nothing explains
is exercised and still wrong. A review that reads one of them alone cannot tell
those two apart.

## The order an agent asks in

1. [`variance reach`](selecting.md) or `variance select` — what the diff can
   reach, and which test files are worth running for it.
2. `variance covering --since <ref>` — the evidence already standing under the
   changed regions, and the regions standing on nothing.
3. The run itself, over the selected files.
4. `variance ask summary`, then `changes` — what moved, grouped under the
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
package](../packages/cli/README.md#covering-which-tests-entered-this-line); the
MCP tool contracts are in the [MCP
package](../packages/mcp/README.md). [Everything an agent can
ask](agent-questions.md) routes the questions this page does not.
