# Run relevant work

[Variance Authority](README.md) renders **subjects** — stories, routes,
fixtures, or values — compares each against its baseline, and records what
changed and why. `variance run --since origin/main` narrows a **run** to the
subjects a source change could plausibly reach, instead of capturing and
comparing every subject in the suite. Source and prior execution can show what
the change might reach, what has exercised that code before, and which useful
answer is nearest.

That command belongs to rendered subjects the Variance Authority CLI owns. For
an existing test suite, `@variance-authority/sense` exports recording and
selection APIs instead: it does not install a command that inventories every
test host or runs the selected files. The repository integrating those APIs
keeps the current inventory, runner identity and invocation for each kind of
test.

## One decision, four readings

Choosing what to run draws on four separate readings of the codebase and its
history, each answering a different part of the decision:

| Question | Reading | Route |
| --- | --- | --- |
| What could this source change reach? | Imports, declarations, unresolved edges, and project-level seeds | [Read source reach](source.md) |
| What was this subject last seen to be made of? | The component names its own baseline recorded when you approved it | [Select the tests that matter](selecting.md) |
| Which tests have actually crossed that code? | The [execution index](execution-record.md) retained from previous runs | [Select the tests that matter](selecting.md) |
| Which selected test is nearest to the edit? | Measured import distance from each test to the changed region | [Measure test distance](distance.md) |

Source reach supplies possibility. The baseline record and the execution index
supply experience, of two different kinds and at two different grains. Distance
supplies order. None is substituted for another, and a use may need only one of
them.

## How far down you have to read

The first two readings answer most of the question for a suite of rendered
subjects.

Source reach is a parse of the repository. The component list is a by-product of
a run you already do: each capture reads the name off every element it collects
and writes the list beside the approved image. React carries that name on the
fiber, so a React suite pays nothing for it; another framework needs a build step
that stamps the name onto the element, which is the same step
[attribution](composition.md) needs anyway.

That second reading is what lets a change to a file reach a **route** at all. A
URL names a page, and nothing in the page's address says which components render
there. What says it is the page having been seen rendering them — so the join is
empirical, and it is exactly as current as the last render you approved.

Together the two answer at the grain of a file: this change is inside
`Button.tsx`, and these subjects were last seen rendering `Button`. For a large
suite that is usually the saving you came for.

The execution index answers below that grain, at the region. Three stories mount
the same component and one of them clicks Remove; the body of that handler is a
place the other two have never been inside, though all three import the same
file. Nothing read from the source tells them apart, because the difference is
not in the tree — it is in what each execution did with it. Reach for that
reading when file-level reach is too coarse to be worth acting on, and read
[the path an execution took](journeys.md) for what it costs to record.

## Start with the saving you need

For rendered subjects, use [test selection](selecting.md) when the outcome is a
smaller run. It owns `--since`, the conservative rules that widen the set, and
the report of what was excluded.

Use [distance](distance.md) when an integration already owns the current test
inventory and runner dispatch, but feedback order matters. Distance orders the
measured part of a selection; it does not discover or execute the suite.

Use [source reach](source.md) when the source scan itself is the question:
which requests were found, how they resolved, what could not be determined, or
why a change widened the answer. The [source index](source-index.md) is the
retained format and invalidation reference beneath those readings.

## The boundary is conservative

Skipping a subject changes how much of the run executes; it is not a claim
that the change left that subject unaffected. A skipped test contributes no
observation and no verdict. Missing coverage, an unreadable edge, an unknown
changed file, or incompatible recorded evidence widens the run or refuses the
selection; it never becomes proof that nothing is affected.

The result supports choosing a workload under named conditions. It does not
describe the unrun surface as unchanged.

## Running fewer is not owning fewer

Selection reduces the work an edit pays for now. It does not decide whether the
suite still needs every test it has accumulated. A hundred overlapping tests
can become a cheap selection and still remain a hundred assertions to
understand, maintain and trust.

[Own fewer tests](own-fewer-tests.md) starts from that longer-lived decision:
whether another test adds a distinct answer, when variation deserves fan-out,
and when temporary or duplicated protection can leave the suite.
