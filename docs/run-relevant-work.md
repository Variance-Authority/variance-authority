# Run relevant work

A change should pay for every test needed to understand it, not every test the
repository can run. Source and prior execution can show what the change might
reach, what has exercised that code before, and which useful answer is nearest.

## One decision, three readings

Running less is not one graph query. Three readings answer different parts of
the decision:

| Question | Reading | Route |
| --- | --- | --- |
| What could this source change reach? | Imports, declarations, unresolved edges, and project-level seeds | [Read source reach](source.md) |
| Which tests have actually crossed that code? | The execution index retained from previous runs | [Select the tests that matter](selecting.md) |
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

Use [source reach](source.md) when the source reader itself is the question:
which requests were found, how they resolved, what could not be determined, or
why a change widened the answer. The [source index](source-index.md) is the
retained format and invalidation reference beneath those readings.

## The boundary is conservative

Selection narrows work, not truth. A skipped test contributes no observation
and no verdict. Missing coverage, an unreadable edge, an unknown changed file,
or incompatible recorded evidence widens the run or refuses the selection; it
never becomes proof that nothing is affected.

The result supports choosing a workload under named conditions. It does not
describe the unrun surface as unchanged.
