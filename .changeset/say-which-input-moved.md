---
'@variance-authority/core': minor
'@variance-authority/dom': minor
'@variance-authority/react': minor
'@variance-authority/unit-test': minor
---

Say which input moved, not just which tag did

`partingOf(baseline, candidate)` climbs from a set of deltas to the component
boundary that owns them and names the input that carried the decision:
`Cart chose differently — useState #0 moved`, with `Summary` reported as having
been handed a different `expanded` and hanging under that line as a
manifestation rather than as a second finding. `explainParting` renders that
as lines. Two runs of one page that differ in a `<p>` where the other has a
`<span>` previously produced a structural delta and nothing to say about it;
the tag is now the symptom and the hook cell is the report.

`holdingOf` from `@variance-authority/react` supplies the evidence — props,
context values and hook cells as digests, per boundary, including
`useSyncExternalStore` snapshots so a store that moved outside React is
distinguished from a component that decided differently on its own. Values are
never carried, only digests, and a holding reaches no hash: `renderHash`,
`structureHash`, `styleHash`, band-exact component digests and
`componentInstances` are all unmoved by it, the same bargain `styleProvenance`
makes. `collect` in `@variance-authority/dom` takes `holdingOf` as a
caller-supplied reader, opt in separately from `wiringOf`, and `capture` in
`@variance-authority/unit-test` now accepts `provenanceOf`, `wiringOf` and
`holdingOf` so a unit test can read one.

A boundary whose own input could not be read is reported as `unread` and never
as nondeterminism: `undetermined` is reserved for a component whose every input
was read and agreed. A wrapper that roots a component boundary no longer
collapses, because collapsing it discarded the holding — the cost is that a run
reading holdings keeps wrappers a run without them removes, which is why both
sides of a comparison must be read the same way.
