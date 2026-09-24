# Spec 0064 — the record in VS Code

**Missing:** a VS Code extension that shows, on every line, *everything* the
record knows about it, and keeps it current as you save. That is Wallaby's bar,
built on a record that knows which *case* walked each region.
[`editors/vscode`](../../editors/vscode/README.md) paints one facet of it: each
range's state in the gutter, its cases and the cases that stopped before it in a
hover, and the frame in the status bar. It starts one `covering --file --text -`
process per repaint, and has none of the facets below the state.
**Built on:** [0063](0063-an-editor-asks-about-the-text-it-holds.md) (the reader,
its facets and the mark vocabulary; this spec adds no reading of its own),
[0067](0067-a-case-carries-its-outcome.md) (outcomes),
[0068](0068-an-edit-runs-what-it-reaches-from-the-editor.md) (runs on save),
[ADR-0043](../context/adr/0043-an-extension-does-not-own-its-host.md) (the host
keeps its own surface), [ADR-0042](../context/adr/0042-a-package-is-named-for-what-it-is-for.md)
(the name).

## Purpose

VS Code's Testing API already provides a test tree, run profiles, per-test
coverage since 1.96 (`FileCoverage.includesTests`,
`loadDetailedCoverageForTest`), *Test: Filter Coverage by Test*, and failure
messages placed at a location. ADR-0043 sends every fact the host can hold
there. The facts the host has no room for are drawn by the extension:

| fact | where it goes |
|---|---|
| test tree, outcomes, durations, failure messages at their frame | the host's `TestController` and `TestRun` |
| `walked` / `hole` | the host's statement coverage, per test |
| `failure`, `failing`, `queued`, `moved`, `parted`, `alone`, `loaded` | one `TextEditorDecorationType` each, in the vocabulary of 0063 item 6 |
| a range's cases | a hover |
| what an edit is and what it will run | a CodeLens on the edited declaration |
| a component's verdict, finding and history | a CodeLens on the component's declaration line |
| a test's attention (queries that came back absent, phases never entered) | inline hints on the test's own lines |

## What would discharge it

**1. A test controller that holds the record and runs selections.** One
`TestController`, whose `TestItem`s are the record's cases grouped by test file.
Their ids are the record's test ids, and they sit at their declaration lines
(0063 item 5). It has two profiles:

- **Run**, which runs the selected items through 0068: the project's runner,
  with its seam, and never a runner of ours.
- **Coverage**, which loads the record as it stands through
  `createTestRun(request, name, false)`. The API documents `persist: false` as
  the flag for coverage saved externally.

When the project also has a runner extension, both controllers appear. Ours is
labelled with the record it reads.

**2. The gutter and the line.** Each range gets its 0063 mark as a decoration.
The five states are painted today; the marks above them (`failure`, `failing`,
`queued`, `parted`) wait on the reader.
A `failure` line also gets the failure message after the code, as Wallaby
prints it, and the host's own `TestMessage` at that location, so *Go to Next
Test Failure* reaches it. The hover lists the cases, each linking to its
declaration, to *run this case*, and to *filter coverage to this case*.

**3. Save runs the near end.** A save hands the buffer to 0068. The status item
reads `running 6 of 11 · 2 failed`, and marks turn from `queued` as outcomes
stream in. When the run leaves tests unrun, the status item names how many and
offers the command that runs them.

**4. The change lens.** On a dirty or unrecorded buffer, a CodeLens above each
changed declaration states the reading (`values: total`, `bodies`, `load`) and
`reaches 4 tests · nearest 0 hops`. Clicking it lists them, with the reason
`select` gives for each.

**5. The component lens.** Where the report has a subject whose component is
declared in this file, a CodeLens above the declaration shows its verdict and
standing (`changed · 212 px · flake 2/40 runs`). Clicking it opens the report
at that subject. The lens is absent when there is no report. It is not shown as
`no findings`.

**6. The host's percentage is labelled as the union it is.** `FileCoverage`
requires a `TestCoverageCount`, and the Test Coverage view prints a percentage
from it. The extension cannot remove it. Its own status item reports counts:
`3 regions one case alone walked, 1 hole`.

*Open decision:* whether riding a host surface that prints a union percentage
is an acceptable price for the per-test filter. The recommendation is yes. It
has to be decided before item 1 is built.

**7. An edit is measured, not assumed.** It is not documented whether host
coverage moves with a dirty buffer. That has to be measured on 1.96 and on the
current release. If it does not move, the extension clears the file's host
coverage when the buffer leaves `recorded`, and its own decorations follow
0063's mapping.

**8. The publish.** The extension lives in `editors/vscode`, outside the npm
workspaces, because it is not an npm package. It bundles no Variance Authority
code and resolves the CLI from the workspace. Item 1 raises its
`engines.vscode` to `^1.96.0`, the first release with per-test coverage. It is
not yet published. It goes to the Visual Studio Marketplace and Open VSX under
the one release number
([ADR-0060](../context/adr/0060-a-release-is-one-version-and-a-pressed-button.md)).
That publish is a second press of the release button, which the release script
has to perform.

**9. The contract is tested as fixtures.** The reply fixtures from 0063 drive a
test in `@vscode/test-electron` that asserts every mark, lens and hover. An
unrecorded line produces nothing, and an absent facet produces no lens.

## What it deliberately does not do

It does not show values, and it does not time-travel. Those need product code
instrumented for what it computes, which the record refuses (0063).
