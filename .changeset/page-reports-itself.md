---
'@variance-authority/sense': minor
---

A page used by hand reports what it ran. `reportPage(address)` from the new
`@variance-authority/sense/page` entry sends a probed page's executed regions to
the watcher `variance watch` started, as a head called `page`. Each load, click
and submit is one execution, and a server whose handler runs inside
`collectJourneys().enter` reports under the same one, so `variance ask ran`
lists a click with the page and the server together. Given no address, or one
that is not `http` on this machine, it installs nothing.
