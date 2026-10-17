---
'@variance-authority/sense': patch
---

`SOURCE_INDEX_VERSION` names the source index format this release reads

`readPublishedSources` returns an index another release wrote with
`state: 'other-version'` and that release's format version in `written`.
`SOURCE_INDEX_VERSION`, exported from `@variance-authority/sense`, is the version
this release reads, so a caller can name both without copying the number.
