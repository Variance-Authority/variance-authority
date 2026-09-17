# Ask one run more than whether it passed

Visual regression tools end at the comparison. `toHaveScreenshot`, Percy,
Chromatic and Argos answer a red build with a pixel count and two images, and
once you have reviewed the diff the reading is spent. A
[Variance Authority](README.md) run writes down what it saw while it was there:
which **subject** rendered — one named UI state you asked for and can ask for
again — and which components drew which regions, at which `file:line`. Add a
semantic snapshot, a [source index](source-index.md) or an execution journal to the run and the
same record also holds the accessible names, roles and visible text, the
declaring files, the custom properties the cascade resolved, and the source
regions the execution entered. That record stays readable after the verdict,
and this page is what you can ask it once the diff is closed.

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
the cascade the component boundaries resolved through, and React's owner chain —
all of it captured during the comparison run and kept afterwards. The second
line is the same record telling you which word classes it holds and which it
does not, so a miss reads as a reading that was never taken rather than as an
absence of matches. [Subject search](locate.md) is the whole of that entrance.

Selection reads the same record from the other end. `variance run --since
origin/main` rules a subject out by naming the components its baseline records
and showing that the diff touched none of them:

```text
[not observed] story:checkout--summary
not affected by the diff against origin/main: its baseline records 4 component(s)
and this diff touched none of them (Button, Badge, Toggle)
```

## The expensive part is knowing what happened

Reaching a real state and observing it without changing it is the work you paid
for. A reading keeps the identities that let later questions meet: the subject,
execution, source region, component, rendered element, conditions, and observer
capability. It keeps absence distinct from a measured empty result, which is why
the `locate` answer above can tell you it never read regions.

With that contract intact, several answers derive from one acquisition instead
of a second account of the run. A checkout can be read without running a test. A
live interface can be inspected without a baseline. An execution can leave a
journey without producing pixels. Rendered comparison combines several readings
because its question needs them.

## What else the data powers

| Capability | Evidence it reuses | The question it answers |
| --- | --- | --- |
| [Test selection](selecting.md) | Source reach, prior per-test execution, and rendered component identities | Which tests and rendered subjects can this change affect? |
| [Distill](distill.md) | Files loaded and entered by one test, joined to the elements and components it deliberately addressed | What can this test shed without losing the behavior it witnesses? |
| [Own fewer tests](own-fewer-tests.md) | Distinct risks, decisions, boundaries, and confirmed distillation findings | Which tests still contribute a decision worth paying to retain? |
| [Sense](../packages/sense/README.md) and the [source scan](source.md) | Imports, exports, declarations, content identities, and incomplete edges read from the checkout | What can this source change reach, and what rests on this file? |
| [Lexicon](lexicon.md) and [subject search](locate.md) | Ids, component names, accessible names, visible text, roles, files, tokens, and entered regions already observed per subject | Which subject does this description mean, and where does it live? |
| [Presentation](presentation.md) | Geometry, semantic structure, browser accessibility, grouping, alignment, repetition, and prominence from one live state | What relationships does this interface communicate right now? |
| [Journeys](journeys.md) | The source regions one execution entered, joined across the processes it touched | Where did this execution travel, and where did two subjects part? |
| [Eyes](eyes.md) | Authored Arrange–Act–Assert phases, addressed elements, React owners, update initiators, and performed work | What did the test deliberately operate, and what work arrived beside it? |
| [Vantage](vantage.md) | Announcements and unfinished work held while a suite is still alive | What is this run doing now, and where did progress stop? |
| [Scenarios](scenarios.md) | Named preconditions, authored Acts, and the semantic state observed after each one | At which transition did two witnessed paths stop agreeing? |
| [Workspace API](agent-workspace-api.md) | Package manifests, TypeScript exports, imports, declarations, and call sites in the current checkout | What does this workspace publish, and where is a name already used? |
| [Composition](composition.md) and [history](history.md) | Component identities, renderings, causes, approvals, and repeated observations | Which apparent changes are one cause, and which changes keep returning? |

These capabilities do not become tests merely because test infrastructure can
produce some of their evidence. A runner may be the process that reaches the
state, just as Storybook, a route collector, an editor, or a live browser may be.
The producer supplies an observation; the consumer decides which question to
ask of it. Selection also closes a loop: the next selected run refreshes the
[execution record](execution-record.md) that future selections, distillation,
and test-retention decisions read.

## What this has to do with visual regression

Visual regression asks whether a rendered state differs from an accepted one.
To act on that answer you need more than the two images: which subject was
rendered, whether the state had finished arriving, what semantic and
accessibility information moved, which component owned the changed region,
which source could have reached it, and whether several diffs are echoes of one
cause.

That is the same [evidence field](evidence-field.md) the other tools read:

- Sense can narrow the states worth rendering before a browser does any work.
- Provenance and composition can turn many changed images into one cause and a
  source location.
- Journeys can distinguish subjects that render the same component but enter
  different handlers or branches.
- Presentation can inspect grouping, spacing, alignment, and repetition in one
  state without claiming a regression or asking for a baseline.
- The [lexicon](lexicon.md) can find the subject a reviewer or agent means without requiring
  them to know its suite id.
- Runtime evidence can explain a state that never became ready enough to
  capture, which pixels cannot report because no honest image exists.

Each of those readings is useful on its own, and rendered comparison is the
question that happens to need most of them at once.

## Read each answer for what it is

Each reading covers a narrower claim than its output may suggest, so check
which one you are holding before you act on it. Presentation measurements
report relationships, not a design decision. A journey records where an
execution went, not why. A lexicon match orients you toward a subject; it does
not confirm you found the right one. Source reach says what could be affected,
while execution says what was witnessed. An absent reading stays unavailable
instead of arriving as a clean result.

What you get for one acquisition is a record several questions can read: the
comparison you ran it for, and the selection, search, distillation and journey
answers you did not have to run anything else to obtain.
