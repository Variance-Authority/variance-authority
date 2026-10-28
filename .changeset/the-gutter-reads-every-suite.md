---
'@variance-authority/editors': patch
---

The gutter paints again in a repository that declares suites

Once a repository declares suites, `variance covering --format json` answers
under `suites`, one entry per suite, and both plugins read only the top-level
ranges, so the gutter stayed empty. Both now read every suite. A line carries
the mark of the nearest suite that ran it, and the hover in VS Code and the
tooltip in WebStorm name every suite that ran the line, with its kind and its
state, then every suite that never loaded the file or has nothing recorded yet.
The cases list groups its cases under the suite that ran them.
