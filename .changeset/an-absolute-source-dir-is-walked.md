---
'@variance-authority/route-collector': patch
'@variance-authority/storybook-collector': patch
---

An absolute `source.dirs` entry is walked

Both collectors joined every `source.dirs` entry onto the working directory, so
an absolute path such as `/repo/packages/ui/src` was looked for under that
directory, matched nothing, and the run was refused for having no source files.
An absolute entry is now walked as written, and a relative one is still resolved
against the working directory. File names in the index stay relative to that
directory either way. When no entry matches any file, the refusal lists each
directory by the absolute path it walked, in place of the entries as spelled
followed by `(from <root>)`.
