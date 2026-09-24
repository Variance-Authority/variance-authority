# Spec 0065 — the record in WebStorm

**Missing:** an IntelliJ Platform plugin that shows, on every line,
*everything* the record knows about it, and keeps it current as you save. It
runs in WebStorm and in any IDE on the platform that opens JavaScript.
[`editors/webstorm`](../../editors/webstorm/README.md) paints one facet of it:
each range's state as a gutter icon and an error-stripe mark, with its cases and
the cases that stopped before it in the tooltip. It starts one
`covering --file --text -` process per repaint. A stale file gets one mark on
line 1. A status bar widget names the holes in the file in front, says when the
record is stale, and carries a refusal in its tooltip.
**Built on:** [0063](0063-an-editor-asks-about-the-text-it-holds.md) (the reader,
its facets and the mark vocabulary), [0067](0067-a-case-carries-its-outcome.md),
[0068](0068-an-edit-runs-what-it-reaches-from-the-editor.md),
[ADR-0043](../context/adr/0043-an-extension-does-not-own-its-host.md),
[ADR-0042](../context/adr/0042-a-package-is-named-for-what-it-is-for.md).

## Purpose

The platform has a coverage subsystem (`com.intellij.coverageEngine`,
`com.intellij.coverageRunner`), and ADR-0043 would normally send this plugin
there. This spec decides against it, for reasons that belong to the host:

- **The per-test half is internal.** `canHavePerTestCoverage`,
  `getTestsForLine`, `findTestsByNames`, `collectTestLines` and the coverage
  gutter's `getLineMarkerRenderer` have been `@ApiStatus.Internal` since
  2024.2. Overriding them gets an internal-API finding from Plugin Verifier and
  breaks without notice.
- **The public half is the union.** It gives hit counts and percentages per
  file, which [`test-level-coverage.md`](../test-level-coverage.md) argues
  against. WebStorm's own Jest and Vitest coverage already provides that.

Wallaby's own IntelliJ plugin draws its own gutter for the same reason. So the
marks are ours, drawn through public API. The run and its test tree stay the
host's. This position reverses if JetBrains makes the per-test methods public
again.

## What would discharge it

**1. A project service that holds one reader.** Today an
`EditorFactoryListener` gives each editor a painter, and each repaint starts a
one-shot `covering` through `GeneralCommandLine` on a pooled thread. Painting
happens on the EDT, and only if the document has not changed since it was read.
The command is `node_modules/.bin/variance`, or else `variance` on `PATH`,
which is the command a terminal in the project would run. What is missing is a
light project service that starts the 0063 reader once, under an
`OSProcessHandler` tied to the project. The status bar widget reads the answer
the selected editor last painted; it has nothing to show while a run is under
way, which item 3 gives it.

**2. The gutter and the line.** Each range becomes a `RangeHighlighter` from the
editor's `MarkupModel`, with a `GutterIconRenderer` and an error-stripe mark in
the vocabulary of 0063 item 6. A `failure` line also gets the failure message
after the code, as an inlay, and a stripe mark that *Next Highlighted Error*
reaches. Clicking a mark opens a popup listing its cases, with outcome and
duration. Each case offers *open at declaration*, *run this case* and *show only
this case's lines*. The last one repaints the file with that one case's regions,
which is Wallaby's *show line tests* turned around.

**3. Save runs the near end, through the host's runner.** A save hands the
buffer to 0068. The run is a run configuration of the host's own Jest or Vitest
type, with the selection as its file and name filter, so the host's test tree,
its failure navigation and its rerun actions all work on it. The widget reads
`running 6 of 11 · 2 failed`, and marks turn from `queued` as the reader
forwards outcomes. Tests left unrun are counted, with the action that runs them.

**4. Inlays for the change and for components.** On a dirty or unrecorded
buffer, a code vision entry above each changed declaration states the reading
and `reaches 4 tests · nearest 0 hops`, and it opens the selection with each
test's reason. Above a component the report names, a code vision entry shows
the verdict and standing (`changed · 212 px · flake 2/40 runs`) and opens the
report at that subject. Each entry is absent when its facet is.

**5. A tool window for the whole record.** The *Variance* tool window has three
tabs:

- **Tests**: every recorded case, with outcome, duration and the files it walks.
- **Change**: the current edit's reading and selection, grouped by distance.
- **Findings**: regions one case alone walked, holes, and parted regions, for
  the open file and for `--since <ref>`.

It shows no percentage and no hit counts. The header names the recorded commit.

**6. The package.** The plugin lives in `editors/webstorm`, outside the npm
workspaces. It is Java 21 against `since-build` `251`, and `build.sh` compiles
it against the classes of an installed IDE, with no Gradle. It runs in every IDE
on the platform that has JavaScript support, so the published plugin is named
for the platform, not for WebStorm. Publishing needs the IntelliJ Platform
Gradle Plugin 2.x, which also brings Plugin Verifier (item 7). Its workspace
`package.json` is private and carries the release number
([ADR-0060](../context/adr/0060-a-release-is-one-version-and-a-pressed-button.md)),
and the same button publishes it to JetBrains Marketplace.

**7. The JVM build is its own gate.** `yarn verify` needs no JDK, and this
plugin does not change that. Gradle, the plugin's tests and Plugin Verifier
over the supported range run in their own CI job. The contract with the reader
is 0063's reply fixtures: the TypeScript side writes them and the plugin's
tests read them.

## What it deliberately does not do

It does not show values, and it does not time-travel (0063). It does not run
tests with a runner of its own: a run is always the host's run configuration.
