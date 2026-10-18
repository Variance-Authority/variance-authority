---
'@variance-authority/cli': minor
'@variance-authority/core': minor
'@variance-authority/playwright': patch
'@variance-authority/raster': minor
'@variance-authority/store': minor
'@variance-authority/storybook': minor
'@variance-authority/storybook-collector': minor
---

A story's parameters are read when the story is reached, so no story file is imported before its story comes up

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
