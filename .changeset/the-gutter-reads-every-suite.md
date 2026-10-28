---
'@variance-authority/editors': patch
'@variance-authority/cli': patch
---

The gutter paints again in a repository that declares suites

Once a repository declares suites, `variance covering --format json` answers
under `suites`, one entry per suite, and both plugins read only the top-level
ranges, so the gutter stayed empty. The JSON answer now carries `marks` beside
`suites`: each run of lines with the one state every suite that ran it makes
together, and their names. Both plugins paint those marks. The hover in VS Code
and the tooltip in WebStorm name every suite that ran the line, with its kind
and its state, then every suite with no answer, with its reason. The cases list
groups its cases under the suite that ran them.
