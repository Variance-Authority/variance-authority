---
'@variance-authority/store': minor
'@variance-authority/raster': minor
'@variance-authority/observe': minor
'@variance-authority/core': minor
'@variance-authority/report': minor
'@variance-authority/remote': minor
'@variance-authority/cli': minor
'@variance-authority/playwright-test': minor
'@variance-authority/vitest-browser': minor
---

A committed baseline is named for its story or test

Under `directory` and `lfs`, a baseline was written to
`<root>/<identity digest>/<percent-encoded subject id>.png`, so a pull request
that accepted one listed a 32-character hex directory nobody could check against
the change, and each machine that accepted wrote its own copy. `baselines.path`
is now a template rendered from what the subject is: `{dir}` and `{file}` (the
file that declares it), `{title}`, `{name}`, `{id}` and `{engine}` (the declared
engine family). The default, `{title}/{name}-{engine}`, writes
`Ui/Button/Primary-chromium.png`; `{dir}/__baselines__/{file}/{name}-{engine}`
with `root: "."` writes `src/ui/Button/__baselines__/Button.stories.tsx/Primary-chromium.png`
beside the code. A label is spelled `Primary__dark-chromium.png`.

The machine that painted a baseline is read from the record beside it. A
baseline painted on another platform, scale factor or engine version is compared
as before, with the moved field named as the cause.

Two subjects that render one path, compared case-folded, stop the run with an
error naming both subjects and both paths. Nothing is renumbered.

`baselines.layout` is removed; a config that sets it is refused with an
error naming `path`. Baselines under the identity directories are still
read: the subject is compared against them, reported `relocated` with both
paths, and the next accept writes the template's path and deletes the old pair,
so the pull request shows a rename. `BaselineKey` carries `file`, `title` and
`name` in place of `path`; the Playwright fixture, the Vitest plugin and
Storybook's index supply them, and `varianceBaselinePath` and `baselinePath`
set the template for a suite run without the CLI.

The git-LFS store's `.gitattributes` pattern and the action's commit-back
pathspecs are the template's glob, so a collocated baseline is tracked and
committed where it is written.
