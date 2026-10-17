---
'@variance-authority/storybook': patch
'@variance-authority/storybook-collector': patch
---

A story file's import is its first story's `collect` on every page

Reading every story's parameters has Storybook import every story file, and
the run did it on the page its first stories were then shown on. Each file's
first story there found its import already done and read a `collect` near
0 ms, while the same story on a worker's page read the whole import, so a
story's figures depended on which page took its file. `readParameters` now
loads the page again at its own address after the reading: the stories after
it meet a document that has imported none of their files, and the reading
itself is in no story's row. A run pays one more preview load for it, not one
per story.
