# Ask one run more than whether it passed

Your build went green, or you approved the diff and closed the report. Nothing a
[Variance Authority](README.md) run observed while getting there has gone
anywhere, and most of what you can now ask it has nothing to do with pixels.

`toHaveScreenshot`, Percy, Chromatic and Argos end at the comparison. They
answer a red build with a pixel count and two images, and once you have reviewed
the diff the reading is spent. A Variance Authority run also writes down what it
saw while it was there: which **subject** rendered — one named UI state you
asked for and can ask for again — and which components drew which regions, at
which `file:line`. Add a semantic snapshot, a [source index](source-index.md) or
an execution journal to the run and the same record also holds the accessible
names, roles and visible text, the declaring files, the custom properties the
cascade resolved, and the source regions the execution entered. That record
stays readable after the verdict, and the rest of this page is what you can ask
it once the diff is closed.

## Ask a closed report a question that is not about pixels

Search the run for a subject you can only describe:

```bash
variance ask locate --query "footer chips"
```

```text
7 of 15 subject(s) match `footer chips`.
Read: id, example, names, text, components, createdBy, files, roles, tokens. Not read: regions (no execution journal was read).

page/footer--counts · 7 boundaries · example of TodoFooter
  where: group `Filters` · src/todo/TodoFooter.tsx:41 · within Todos › Footer
  footer: id `page/footer--counts`; example `TodoFooter`; components `TodoFooter`; createdBy `TodoFooter`
  chips: components `Chip`
```

No baseline was consulted and no browser opened. The answer came out of markup,
the cascade the component boundaries resolved through, and React's owner chain,
all of it captured during the comparison run and kept afterwards. The second
line tells you which word classes the record holds and which it does not, so a
miss reads as a reading that was never taken rather than as an absence of
matches. [Finding a subject](locate.md) covers the whole of that entrance.

## Rule a subject out without rendering it

Selection reads the same record from the other end. `variance run --since
origin/main` rules a subject out by naming the components its baseline records
and showing that the diff touched none of them:

```text
[not observed] story:checkout--summary
not affected by the diff against origin/main: its baseline records 4 component(s)
and this diff touched none of them (Button, Badge, Toggle)
```

How much that saves is decided by where your diff sits, not by how large it is.
Measured on [Material UI](https://github.com/mui/material-ui)'s recorded suite
of 184 test files, a five-file diff confined to one subtree runs 31 of them; the
same five files scattered across the repository run 155, because the tests
really did enter all of that. Adjacent files share most of their audience, and a
utility most of the library imports is a hub that correctly selects almost
everything. [Addressing scale](scale.md) carries that arithmetic, and one
recording of your own suite answers it for your repository rather than for this
one.

## What else the data powers

Each row is one capability, its evidence, and the question you would be asking
when you reach for it.

| Capability | Evidence it reuses | The question it answers |
| --- | --- | --- |
| [Test selection](selecting.md) | Source reach, prior per-test execution, and rendered component identities | Which subjects does this diff make worth rendering again? |
| [`variance select`](../packages/cli#select-what-your-own-runner-may-skip) | The same record, reported as test files rather than as subjects | Which of my test files can my own runner skip for this diff? |
| [Distill](distill.md) | Files loaded and entered by one test, joined to the elements and components it deliberately addressed | Which parts of this test does the behavior it witnesses not need? |
| [Own fewer tests](own-fewer-tests.md) | Distinct risks, decisions, boundaries, and confirmed distillation findings | Do these six tests protect six decisions, or one decision six times? |
| [Source scan](source.md), read by [Sense](../packages/sense/README.md) | Imports, exports, declarations, content identities, and incomplete edges read from the checkout | If I change this file, what else is involved? |
| [Search](lexicon.md) | Ids, component names, accessible names, visible text, roles, files, tokens, and entered regions already observed per subject | Which subjects answer to this word? |
| [Finding a subject](locate.md) | The same per-subject words, matched against a description | I can describe the thing but I do not know its id — which subject is it? |
| [Presentation](presentation.md) | Geometry, semantic structure, browser accessibility, grouping, alignment, repetition, and prominence from one live state | Has this row drifted out of line with the rows it repeats? |
| [Journeys](journeys.md) | The source regions one execution entered, joined across the processes it touched | Which lines did this subject actually go through while it painted? |
| [Parting](parting.md) | Two recorded readings of the same component, compared back to the input where they diverged | These two renders differ — at which input did they stop agreeing? |
| [Eyes](eyes.md) | Authored Arrange–Act–Assert phases, addressed elements, React owners, update initiators, and performed work | Which surface did this test deliberately operate, rather than merely render? |
| [Vantage](vantage.md) | Announcements and unfinished work held while a suite is still alive | My suite is hanging — which call has not come back yet? |
| [Scenarios](scenarios.md) | Named preconditions, authored Acts, and the semantic state observed after each one | Two runs end differently — at which step did they first disagree? |
| [Workspace API](agent-workspace-api.md) | Package manifests, TypeScript exports, imports, declarations, and call sites in the current checkout | Is this name already exported here, and who calls it? |
| [Composition](composition.md) | Component identities and renderings joined across many subjects in one revision | Twelve subjects changed — is one component behind all of them? |
| [History](history.md) | Causes, approvals, content identities, and repeated observations kept across runs | Has this been drifting for months, and did this flake start today? |

Selection closes a loop with the rest: the next selected run refreshes the [execution
record](execution-record.md) that future selections, distillation and
test-retention decisions read.

## What this has to do with visual regression

Visual regression asks whether a rendered state differs from an accepted one. To
act on that answer you need more than the two images: which subject was
rendered, whether the state had finished arriving, what semantic and
accessibility information moved, which component owned the changed region, which
source could have reached it, and whether several diffs are echoes of one cause.

That is the same [evidence field](evidence-field.md) the readings above draw on:

- The source scan narrows the states worth rendering before a browser does
  any work.
- Provenance and composition turn many changed images into one cause and a
  source location.
- Journeys distinguish subjects that render the same component but enter
  different handlers or branches.
- Presentation inspects grouping, spacing, alignment and repetition in one state
  without claiming a regression or asking for a baseline.
- The [lexicon](lexicon.md) finds the subject a reviewer or agent means without
  requiring them to know its suite id.
- Runtime evidence explains a state that never became ready enough to capture,
  which pixels cannot report because no honest image exists.

Each of those readings is useful on its own, and rendered comparison is the
question that happens to need most of them at once.

## Read each answer for what it is

Each reading covers a narrower claim than its output may suggest, so check which
one you are holding before you act on it. Presentation measurements report
relationships, not a design decision. A journey records where an execution went,
not why. A lexicon match orients you toward a subject; it does not confirm you
found the right one. Source reach says what could be affected, while execution
says what was witnessed. A reading that was never taken stays unavailable rather
than arriving as a clean empty result, which is why the `locate` answer above
can tell you it never read regions.

## What keeping the record costs

You pay in three places, and none of them is per seat. The scan that keeps the
[source index](source-index.md) current runs before every run that selects;
[what a source scan costs](performance.md) prices that stage against one Chromium paint
of one subject, and a suite of any size pays it once per run. The three files
the record lives in — the source index, the [execution record](execution-record.md)
and the [lexicon](lexicon.md) — are sized in [addressing scale](scale.md), each
against a different count of your own: the modules in your checkout, the modules
your suite enters, and the subjects it captures. The scan's caches sit under
`XDG_CACHE_HOME`, outside the work tree, so nothing about them is committed and
`git clean` will not take them. Instruments you have not installed cost nothing:
journeys need a build carrying the selection probes, and `openVantage()` reads
one environment variable per worker and returns nothing when it is unset. What
accumulates across runs lives in a service you run in your own infrastructure,
and it stores no pixels.

## Get a record you can ask questions of

One run produces it. In a Playwright test you already have, install the package
and add one `observe` call and one assertion:

```bash
npm install --save-dev @variance-authority/playwright-test @playwright/test
npx playwright install chromium
```

Storybook, application routes, unit tests and custom collectors run the same
loop from the CLI instead:

```bash
variance run --config variance.config.json
```

Either way the first run writes the record this page describes, and
`variance ask locate` is the cheapest question to put to it.
[Observe one state](start.md) takes one subject through capture, review and
acceptance, and chooses the harness to start from.
