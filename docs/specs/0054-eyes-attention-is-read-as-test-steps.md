# Spec 0054 — Eyes attention is read as test steps

**Missing:** the person reading. An `EyesArchive` already records one ordered,
explicitly complete or partial journal per test. `variance_test_attention` can
print that journal for an agent. No observation names the journal produced by
its test, no run artifact contains the relation, and neither the text nor HTML
report can put the interactions beside the subject a person is reviewing.

The missing capability is one reading of evidence Eyes already produced. It is
not another recorder, a Playwright reporter, or a scenario engine.

## 1. What “Test steps” means here

The section will be the Eyes chronology for the test that produced an
observation:

- authored Arrange, Act and Assert boundaries;
- Testing Library queries and their resolved, absent or thrown outcomes;
- consumed Playwright Locator actions, reads and assertions, including the
  locator chain and its arguments;
- document events and React commits observed between those operations; and
- the copied target identity, React ownership path and source location Eyes
  recorded before the rendered tree changed.

The section will preserve every journal entry in `sequence` order. Entry kinds
may be styled differently, but a reader may not merge a locator action with a
document event, turn a React commit into an action, or move evidence under a
nearby phase. Eyes distinguishes those facts on purpose. Arrange, Act and Assert
groups begin only at an `eyes-phase` entry; no formatter infers a phase from the
API call that came next.

“Test steps” will not mean Playwright's runner trace. Browser launch, fixture and
hook setup, arbitrary `test.step()` labels, and page methods Eyes does not
observe are absent. The report will not reconstruct them from source or copy
them from Playwright internals. A consumer that needs Playwright's own step tree
will read the host's artifact; this capability says what the test addressed and
what the rendered page did while it addressed it.

It is not a `ScenarioExecution`. A scenario declares an Act key before it runs
and records the state reached after that Act. Eyes records the selectors,
events, assertions and commits that happened inside a test. A report may show
both without treating either as a substitute for the other.

## 2. The join is exact and test-scoped

One test may observe several visual subjects, so copying its journal into every
`ObservationRecord` would make report size proportional to subjects rather than
tests. The run artifact will store each `EyesTestAttention` once and each
observation produced inside that test will name it by exact identity.

The writer will take that identity from the runner seam that opened the journal.
For Playwright that seam already has `testInfo.testId`; for Testing Library it is
the id passed to `watchTest`. A title, file name, subject id or partial string is
not a join key. If the surface cannot state the exact relation, the observation
has no attention reference.

Retries make an id alone insufficient: two attempts of one Playwright test have
the same test id and different evidence. The relation will identify the attempt
that produced the observation, while retaining the stable test id used by Eyes,
Sense and user-facing lookup. Folding may not overwrite the first attempt with
the last or require retries to be disabled.

A parser will reject a dangling attention reference. A shard merge will
deduplicate the same journal only when its bytes agree and will refuse two
different journals under one test-and-attempt identity. An archive supplied with
no matching observation remains valid evidence but is not shown under an
unrelated subject.

This join is the narrow part of [the embedded-surface gap](0053-a-surface-inside-a-suite-reaches-less.md).
It does not give that surface history, acceptance, sensitivity configuration or
a general run writer.

## 3. Absence, emptiness and partial evidence stay distinct

The person reading will see the same three states the archive validates:

- no attention reference means the writer did not supply Eyes evidence;
- a complete journal with no attention entries means Eyes measured an empty
  chronology; and
- a partial journal prints its reason before the entries that survived.

None of the three changes the subject's verdict or exit code. Missing or partial
test steps do not turn a visual change into a pass or a failure. They qualify
the explanation available to the reviewer.

The HTML reading will remain self-contained. It will not fetch the Eyes archive
after the page opens, and a hosted reader will not contact the test runner. The
text, HTML and agent readings will use one formatter over the same retained
journal, so a person and an agent cannot receive different descriptions of the
same sequence.

## 4. Retention is chosen before collection is uploaded

An Eyes journal can contain selector arguments, accessible names, element text,
attributes and source locations. Adding it to a build changes what that build
stores. The integration will therefore be explicit: enabling Eyes collection
does not by itself authorize a run or hosted review service to retain the
journal.

The writer will either include the journal in the run artifact under that
artifact's retention and access boundary, or omit the attention reference. It
will not leave a local path in a portable report, upload an archive as an
untracked side file, or replace omitted evidence with an empty journal. A local
single-run report will work without a hosted service.

## 5. What will discharge this spec

One external Playwright case will record Eyes attention for a visual test that:

1. declares Arrange, Act and Assert;
2. performs two locator actions and one assertion against attributed React
   targets;
3. produces two visual subjects from the same test; and
4. runs once with a complete journal, once with an explicitly partial journal,
   and once through a retry.

The run artifact will contain one journal per test attempt and exact references
from both observations. Its text and self-contained HTML readings will show the
entries in sequence, identify the targets and their source, state completeness,
and omit Playwright fixture and hook work that Eyes never observed. The agent
answer for the same journal will agree entry for entry.

The case will also prove the refusals: a dangling reference will fail parsing, a
conflicting shard journal will fail merging, a complete empty journal will not
read as missing, and a report with no attention reference will not claim that
the test performed no steps.

When those checks pass through the public Playwright integration and the report
reader, the decisions forced by the implementation will move into ADRs, the
checkpoint will name the exercised capability, and this file will be deleted.
