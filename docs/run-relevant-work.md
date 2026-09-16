# Run relevant work

[Variance Authority](README.md) renders **subjects** — stories, routes,
fixtures, or values — compares each against its baseline, and records what
changed and why. `variance run --since origin/main` narrows a **run** to the
subjects a source change could plausibly reach, instead of capturing and
comparing every subject in the suite. Source and prior execution can show what
the change might reach, what has exercised that code before, and which useful
answer is nearest.

## One decision, three readings

Choosing what to run draws on three separate readings of the codebase and its
history, each answering a different part of the decision:

| Question | Reading | Route |
| --- | --- | --- |
| What could this source change reach? | Imports, declarations, unresolved edges, and project-level seeds | [Read source reach](source.md) |
| Which tests have actually crossed that code? | The [execution index](execution-record.md) retained from previous runs | [Select the tests that matter](selecting.md) |
| Which selected test is nearest to the edit? | Measured import distance from each test to the changed region | [Run the nearest tests first](distance.md) |

Source reach supplies possibility. Recorded execution supplies experience.
Distance supplies order. None is substituted for another, and a use may need
only one of them.

## Start with the saving you need

Use [test selection](selecting.md) when the outcome is a smaller set of tests.
It owns `--since`, the conservative rules that widen the set, and the report of
what was excluded.

Use [distance](distance.md) when the set is already known but feedback order
matters. Near tests run first because they usually fail for the simplest reason;
distance does not remove a selected test.

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
