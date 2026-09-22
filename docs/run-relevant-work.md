# Run relevant work

Not every subject in your suite can be touched by the file you just edited.
[Variance Authority](README.md) rules out the ones that cannot, before a browser
opens.

This page is for deciding how much of that work one source change has to pay
for. It lays out the four readings a narrowed run draws on and points at the
page that owns each. New here? Start with [your first run](start.md).

A **subject** is one named UI state you asked for and can ask for again,
identified by a stable id like `story:checkout--empty`.
`npx variance run --since origin/main` narrows a run to the subjects a source
change could plausibly reach, instead of capturing and comparing every subject
in the suite. The CLI is a devDependency:

```bash
npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector
npx playwright install chromium
```

[Your first run](start.md) has the config and the collector that command reads.

That command covers the subjects the CLI renders. For an existing test suite,
[`@variance-authority/sense`](https://variance-authority.dev/reference/packages/sense)
exports recording and selection APIs and installs no command: it does not
inventory your test hosts or execute the files it selects, so the current test
inventory, runner identity and invocation for each kind of test stay with your
repository.

## One decision, four readings

Choosing what to run draws on four separate readings of the codebase and its
history, each answering a different part of the decision:

| Question | Reading | Route |
| --- | --- | --- |
| What could this source change reach? | Imports, declarations, unresolved edges, and project-level seeds | [Read source reach](source.md) |
| What was this subject last seen to be made of? | The component names its own baseline recorded when you approved it | [Select the tests that matter](selecting.md) |
| Which tests have actually crossed that code? | The [execution index](execution-record.md) retained from previous runs | [Select the tests that matter](selecting.md) |
| Which selected test is nearest to the edit? | Measured import distance from each test to the changed region | [Measure test distance](distance.md) |

The **execution index** is what a run keeps about itself: which regions of which
modules each test file actually covered, retained so a later change can be asked
who has been there. Source reach supplies possibility, the baseline record and
the execution index supply experience at two different grains, and distance
supplies order. A given question may need only one of them.

## How far down you have to read

The first two readings answer most of the question for a suite of rendered
subjects.

Source reach is a parse of the repository. The component list is a by-product of
a run you already do: each capture reads the name off every element it collects
and writes the list beside the approved image. React puts that name on the
fiber, so a React suite pays nothing for it; another framework needs a build step
that stamps the name onto the element, which is the same step
[attribution](composition.md) needs anyway.

That second reading is what lets a change to a file reach a **route** at all. A
URL names a page, and nothing in the page's address says which components render
there. What says it is the page having been seen rendering them — so the join is
empirical, and it is exactly as current as the last render you approved.

Together the two answer at the grain of a file: this change is inside
`Button.tsx`, and these subjects were last seen rendering `Button`.

What that is worth depends on where your change landed, not on how many files it
touched. On [Material UI](https://github.com/mui/material-ui)'s recorded Vitest
suite of 184 test files, a five-file diff confined to one subtree selects 31 of
the 184; the same five files scattered across the repository select 155. Walk
every file in that suite one at a time and the median file selects 7% of the
suite, while the ninetieth percentile selects 84% — a utility most of the
library imports genuinely could break most of it. The
[scale reference](scale.md#what-decides-the-value-is-what-changed-not-how-much)
gives those counts and how they were taken, and
[how the test-to-code map stays small](how-selection-scales.md) prices the
evidence they are read from.

The execution index answers below that grain, at the region. Three stories mount
the same component and one of them clicks Remove; the body of that handler is a
place the other two have never been inside, though all three import the same
file. Nothing read from the source tells them apart, because the difference is
not in the tree — it is in what each execution did with it. Use that reading when
file-level reach is too coarse to be worth acting on, and read
[the path an execution took](journeys.md) for what it costs to record.

## Start with the saving you need

For rendered subjects, use [test selection](selecting.md) when the outcome is a
smaller run. It owns `--since`, the conservative rules that widen the set, and
the report of what was excluded.

To find out what your own runner could have skipped on a recent change, record
one run with the Vitest or Jest integration installed, then ask:

```bash
npx vitest run
npx variance select --format json
```

`select` prints a **skip** list, never a run list: stdout is paths and
nothing else, and an empty answer runs your whole suite rather than none of it.
It reads no `variance.config.json`, so a repository that uses Variance Authority
for nothing else can still ask. The
[CLI reference](https://variance-authority.dev/reference/packages/cli) has the
other output formats and the conditions under which it declines to narrow.

Use [distance](distance.md) when an integration already owns the current test
inventory and runner dispatch, but feedback order matters. Distance orders the
measured part of a selection; it does not discover or execute the suite.

Use [source reach](source.md) when the source scan itself is the question:
which requests were found, how they resolved, what could not be determined, or
why a change widened the answer. The [source index](source-index.md) is the
retained format and invalidation reference beneath those readings.

## The boundary is conservative

Skipping a subject changes how much of the run executes; it is not a claim that
the change left that subject unaffected. A skipped subject produces no image and
no **verdict** — the one word a result reports, from `unchanged` through
`needs-review` to `violation`. Missing coverage, an unreadable edge, an unknown
changed file, or incompatible recorded evidence widens the run or refuses the
selection; it never becomes proof that nothing is affected. A narrowed run
reports what it did not render; it does not report the unrendered subjects as
unchanged.

## Running fewer is not owning fewer

Selection reduces the work an edit pays for now. It does not decide whether the
suite still needs every test it has accumulated. A hundred overlapping tests
can become a cheap selection and still remain a hundred assertions to
understand, maintain and trust.

[Own fewer tests](own-fewer-tests.md) starts from that longer-lived decision:
whether another test adds a distinct answer, when variation deserves fan-out,
and when temporary or duplicated protection can leave the suite.

[On testing](on-testing.md#coverage-opens-the-question-it-does-not-close-it)
explains why execution cost, test ownership, and confidence are separate
decisions. Selection changes only what runs now.
