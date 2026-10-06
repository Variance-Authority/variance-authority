---
'@variance-authority/sense': patch
---

An edit to a module loaded as both source and build selects by region again

Each region's digest is now cut from the lines of source it maps to, not from
the text a build emitted, so the source and the build of one module record the
same digests. Before, after a real edit to such a module, comparing the two
builds' digests read every region as edited and selected every test that loaded
the module. Records written before this release compare once against the new
digests: the first edit to a module after upgrading selects every test that
entered it.
