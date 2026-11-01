# @variance-authority/storybook

## 0.22.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.19.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.18.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.16.0

### Minor Changes

- 402ce9f: A story's parameters are read when the story is reached, so no story file is imported before its story comes up

  Your Storybook run used to read every story's `parameters.variance` before the
  first story, through the preview's `extract()`. That imported every story file
  up front: on a large Storybook you paid for the whole build before seeing one
  story, and each file's first story then timed its import as 0 in `collect`.

  The run now plans from `index.json` alone. When it reaches a story, it asks the
  preview for that story's merged parameters, which imports only that story's
  file, the import showing the story would have made anyway. That import is
  charged to the story's `collect`, so the first story of each file carries what
  its file costs. A story that excludes itself is still skipped and listed in the
  report with its reason, and a story whose parameters cannot be read is read at
  your run's `viewport` with a warning naming it. A preview too old to read one
  story's parameters says so once per run, not once per story.

  A story that declares `widths` is still read as `<story id>@<width>` at each
  width, with its own baseline, and all its widths are read on the same page in
  one visit: nothing is opened, booted or loaded again for a second width. A
  run that does not read such a story, because `--subjects`, `--since` or a shard
  left it out, because its visit failed, or because its parameters could not be read, still counts its width baselines as
  planned rather than naming them as baselines your plan no longer holds. A
  story that excludes itself when it is reached holds no subject of the run, so
  every baseline it left, under its own id and at each width, is named. A
  shard prices the story at the sum of the widths its last visit read.

  If you write a collector, `collect` may now return a `Visit` instead of a
  `Collected`: every subject the visit to the planned one produced, each with its own
  result, each id the planned id or the planned id at a width (`<id>@<width>`),
  and any warnings the visit raised. A visit that could not learn every subject
  it realizes, such as a story read without its parameters, says `incomplete: true`.
  A visit that produced no subject is
  reported as a failed one, and so is a visit that produced any other id. The run and `variance collect` report each subject
  at the position the plan gave the planned subject, and evidence parts record
  the planned id as `of`; a merge refuses a part whose subject is neither. A
  `--subjects` glob that names one width, such as `*@375`, now reaches the story
  it comes from, and only a width suffix extends a story id: `button--primary`
  no longer reaches `button--primary-large`.

  `@variance-authority/core/format` exports `atWidth`, which writes a subject's
  id and name at a width, and `widenedFrom`, which reads the planned id back
  from a width id, and `realizes`, which says whether a visit to one id may
  produce another.

  `readParameters(page)` is now `readParameters(page, storyId)` and returns one
  story's parameters; the up-front read of every story is gone.
- d7f8b72: A story's execution record now says where the browser spent it, timed by the page: `prepare` for the preview's load, paid by the first story read on a document and 0 for every later one; `collect` for importing the story's file and unmounting the story before it; `cases` for the render through `afterEach`. `collectStory` returns them as `timing`, and `watchStoryTiming` starts the page's watch; the collector's page agent runs it.
- 2bfc647: A story is ready only when Storybook says so. The markup-quiescence fallback is gone, and with it the `markup-quiescent` readiness: markup that stopped changing cannot see a story still waiting on a fetch, a font or an image. The story the URL selected is read from Storybook's `currentRender`, so one still loading or playing is waited for rather than called `already-rendered`. A story with no `storyRendered` within `timeoutMs` is a `timeout` naming it, and a preview with no Storybook channel refuses every story unless `readySelector` is configured.

### Patch Changes

- 79857fe: A story switched to over the channel costs its render and nothing fixed

  Each story used to pay about 112 ms that it did not spend rendering: Storybook's
  own 100 ms timer before it looks for running animations, and a poll for
  `storyFinished` that asked every 50 ms. `collectStory` now sets the switch
  Storybook reads to skip that timer on each document it navigates, removes the
  animation-pausing stylesheet that switch also adds so your page keeps its
  animation state, and hands a story on when `storyFinished` arrives. On the case
  Storybook a switched story went from about 112 ms to about 3.3 ms, with every
  capture unchanged. The first story of a document still pays Storybook's timer
  once.

  A first story whose render was already over before the adapter started watching
  is now taken as finished, rather than waited on for `timeoutMs` and the preview
  then treated as one that never emits `storyFinished`.

## 0.15.0

### Patch Changes

- ef496ad: READMEs name what the program does

  The package READMEs, and the `@variance-authority/vantage` and
  `@variance-authority/playwright-test` descriptions, no longer write a test, a
  record or a run as something that says, asks or knows. Each sentence names what
  the program does: a command prints, a record holds a field, a test runs or
  covers. Where a value is filled in from configuration or a default rather than
  recorded, the README says so. Four renamed headings change their anchors:
  `help`'s "Where the declaration is undocumented", `playwright`'s "Where a
  component is declared, read from the engine", `storybook`'s "What a pass sends
  the preview" and `sense`'s "Correct what a file's text declares it imports".

## 0.14.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.9.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.7.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.6.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.10

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.9

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.8

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.2.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

First release.
