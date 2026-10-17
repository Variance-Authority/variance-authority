---
'@variance-authority/playwright': patch
'@variance-authority/storybook': patch
'@variance-authority/storybook-collector': patch
---

A story file's import is its first story's `collect` on every page

Reading every story's parameters has Storybook import every story file, and
the run did it on the page its first stories were then shown on. Each file's
first story there found its import already done and read a `collect` near
0 ms, while the same story on a worker's page read the whole import, so a
story's figures depended on which page took its file. The Storybook collector
now reads the parameters on a document of its own, in a browser context it
opens on the run's browser while the stories' page boots, so the reading is in
no story's row and the stories' page still loads once. `createObservedHarness`
takes an optional third argument, called with the page once its observers are
in and before it navigates, for work that should overlap the boot.
