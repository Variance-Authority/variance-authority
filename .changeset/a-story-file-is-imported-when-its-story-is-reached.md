---
'@variance-authority/cli': minor
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
your run's `viewport` with a warning naming it.

A story that declares `widths` is still read as `<story id>@<width>` at each
width, with its own baseline, and all its widths are read on the same page in
one visit: nothing is opened, booted or loaded again for a second width.

If you write a collector, `collect` may now return a `Visit` instead of a
`Collected`: every subject the visit to the planned one produced, each with its own
result, each id beginning with the planned id, and any warnings the visit
raised. The run and `variance collect` report each of them at the position the
plan gave the planned subject, and evidence parts record the planned id as
`of`. A `--subjects` glob that names one width, such as `*@375`, now reaches
the story it comes from.

`readParameters(page)` is now `readParameters(page, storyId)` and returns one
story's parameters; the up-front read of every story is gone.
