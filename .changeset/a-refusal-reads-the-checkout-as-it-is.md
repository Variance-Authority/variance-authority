---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/mcp': patch
---

A refusal reads the checkout as it is

`variance ask`, `variance serve`, `variance-authority-help` and its server
reused a published source generation for an hour, and the dependency lexicon
was built only under `variance index`, so a function written since the last
index was refused as not published, and a fresh checkout refused an installed
package's export with *the dependency lexicon is not published*. Both read as
real absences. A refused question is now asked again of a generation made from
the checkout now, with the dependency lexicon built when it is missing or
behind, and only that answer is given; an answer that found its name still
comes from the reused generation, so only a refusal pays for the reading.
Under `--just-answer` or `justAnswer`, and on `search` when no changed files are
named, every answer and refusal says the checkout was not compared with the
generation, and `search --format json` carries `compared: false`. The help
package exports `caughtUp` and `snapshotLine` for hosts of their own, and
`serve` from `@variance-authority/mcp` takes an `again` hook that asks a
refused call again with a fresher subject.
