# Review a pull request

A diff shows what changed and nothing about what watched it: a changed branch no
test ran reads like every other line. This path puts the evidence beside the
diff, in the order a review reaches for it: what stood under each changed
function before CI ran, the part of one that no case ran, what CI's run did,
what the change did to the layering, and what may block the merge.

[Variance Authority](README.md) answers from the record your suite writes once
its runner config is wrapped, as [Jest or Vitest](start-unit.md) sets up, and
from the [source index](source-index.md) of your checkout. Each step below links
the page that owns its command and its rules.

## 1. Hand the first reading to the review

The author takes this step; a reviewer reads its result. A review bot reads the pull request's body before CI has run anything. Run
`variance review --since origin/main --format handover` when you open the pull
request and paste its block under what you wrote: one collapsed line for a
person, and for each changed function worth a look, how many cases stood on it
and the test file to open; 🔴 marks a function with a part no case ran.

[Hand the first reading to a review bot](agent-code-review.md#hand-the-first-reading-to-a-review-bot)

## 2. Read the region a changed function left unrun

A function the block marks 🔴 has a part no case ran. Ask the record for that
file and that function, and it names the part no case ran, in each suite, and
the cases on the rest.

[Ask the record what covered the change](agent-code-review.md#ask-the-record-what-covered-the-change),
then [which tests covered this line](../packages/cli/README.md#covering-which-tests-covered-this-line)
for one file in full.

## 3. Read what CI's run did

Once the suite has run on the change, CI posts one comment, updated in place,
that counts the changed regions first: which new code no case covered, which
code only a test further than one import away covered, and which cases were
added or removed.

[Review what a change did](../packages/cli/README.md#review-what-a-change-did-for-the-person-merging-it)

## 4. See what the change did to the layering

One import can lift a package a layer, and every package above it with it.
Compared against the base's source index, the answer names the packages whose
own imports moved them, and counts the rest.

[What a pull request shows](boundaries.md#what-a-pull-request-shows)

## 5. Decide what blocks the merge

Posting the reading blocks nothing. A project that wants a rule writes it as a
count, not a percentage: a changed function with code no case ran, or a region
the mainline ran that the change stopped running.

[The gate](gates.md#the-gate)
