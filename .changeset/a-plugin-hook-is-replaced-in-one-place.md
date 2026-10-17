---
'@variance-authority/sense': patch
---

A Vite plugin's hook is replaced in one place

`afterHook`, from `@variance-authority/sense/journal`, replaces a resolved
plugin's `transform` or `load` with one that calls the plugin's own handler and
hands what it answered, once a promise settles, to your function, with the
context and arguments of the call. An object hook keeps its `order` and
`filter`. The probes watch every other plugin's steps through it, and the
Storybook addon edits Storybook's preview rewrite through it.
