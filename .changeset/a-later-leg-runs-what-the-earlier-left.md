---
'@variance-authority/cli': patch
---

`3-` runs the near tests `0-2` did not run, so the two legs run every selected file

`0-2` saves its run before `3-` is cut, so `3-` reads another record: the tests
`0-2` ran are at HEAD, and every other test is read from where it last ran. That
reading can bring a test within two imports of the change that the reading `0-2`
was cut from did not select, and neither leg ran it. In this repository, an
inserted function selected 5 such tests at 2 hops after `0-2` had run.

A leg that starts past 0 hops, cut after a run was saved at HEAD, now also runs
every selected test nearer than its first hop that still last ran before HEAD,
and says how many on stderr. A test `0-2` ran is at HEAD, so none runs twice.
