# With great data comes great…

…tests, certainly. A useful test needs more than an assertion: it needs to know
which state it reached, what the execution addressed, which source produced the
result, and where its evidence ends. That data makes the test cheaper to select,
easier to diagnose, and harder to fool.

Once those facts exist, throwing them away after one assertion or screenshot
would be a strange constraint. The same evidence can find an unnamed subject,
explain a live interface, show where an execution travelled, map a workspace,
or tell an agent what to inspect next. Tests and visual comparison are important
consumers of the data. They are not its owners.

## The expensive part is knowing what happened

The difficult work is reaching a real state and observing it without changing
it. A useful reading keeps the identities that let later questions meet: the
subject, execution, source region, component, rendered element, conditions, and
observer capability. It also keeps absence distinct from a measured empty
result.

Once that contract is intact, several answers can be derived without repeating
the acquisition or inventing a second account of the run. Each consumer takes
the evidence its question needs and leaves the rest independent.

A checkout can be read without running a test. A live interface can be inspected
without a baseline. An execution can leave a journey without producing pixels.
Visual comparison combines several readings because its question needs them; it
is one composition of the evidence, not the pipeline every capability must
enter.

## What else the data powers

| Capability | Evidence it reuses | The question it answers |
| --- | --- | --- |
| [Test selection](selecting.md) | Source reach, prior per-test execution, and rendered component identities | Which tests and rendered subjects can this change affect? |
| [Distill](distill.md) | Files loaded and entered by one test, joined to the elements and components it deliberately addressed | What can this test shed without losing the behavior it witnesses? |
| [Own fewer tests](own-fewer-tests.md) | Distinct risks, decisions, boundaries, and confirmed distillation findings | Which tests still contribute a decision worth paying to retain? |
| [Sense](source.md) | Imports, exports, declarations, content identities, and incomplete edges read from the checkout | What can this source change reach, and what rests on this file? |
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
execution record that future selections, distillation, and test-retention
decisions read.

## What this has to do with visual regression

Visual regression asks whether a rendered state differs from an accepted one.
Great visual regression needs more than two images if its answer is meant to be
actionable. It needs to know which subject was rendered, whether the state had
finished arriving, what semantic and accessibility information moved, which
component owned the changed region, which source could have reached it, and
whether several diffs are echoes of one cause.

That is the same evidence field the other tools read:

- Sense can narrow the states worth rendering before a browser does any work.
- Provenance and composition can turn many changed images into one cause and a
  source location.
- Journeys can distinguish subjects that render the same component but enter
  different handlers or branches.
- Presentation can inspect grouping, spacing, alignment, and repetition in one
  state without claiming a regression or asking for a baseline.
- The lexicon can find the subject a reviewer or agent means without requiring
  them to know its suite id.
- Runtime evidence can explain a state that never became ready enough to
  capture, which pixels cannot report because no honest image exists.

Visual comparison benefits from all of this context. None of it has to pretend
to be visual comparison to justify its existence.

## Evidence creates options, not authority

More data does not license more conclusions. Presentation measurements do not
choose a design. A journey is not a trace or a verdict. A lexicon match is
orientation, not proof. Source reach says what could be affected, while
execution says what was witnessed. An absent reading remains unavailable rather
than becoming a clean result.

The payoff is narrower and more useful: collect an honest observation once,
preserve the boundaries that make it interpretable, and let each consumer ask
the strongest question that evidence can answer. That produces better tests,
better visual review, and better tools for work that is neither.
