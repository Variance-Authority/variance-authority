---
'@variance-authority/cli': patch
---

A config below the repository root loads when the root's suites carry to the root's share

`variance run`, `adjudicate` and every other command reading a
`variance.config.json` below the repository root used to exit 2 with
`` `suites.<name>.carry` is "share", and the file has no `share` section to carry it `` whenever the root declared its suites with `"carry": "share"`. A suite carries
to the root config's `share` section, which is where `share --suite` and
`select` read it, so that is the section the check now reads. A member config
needs no `share` of its own. A root whose suites carry to a share it has no
section for is still refused, and a member config under it is refused naming
the root file, which is where the section goes.
