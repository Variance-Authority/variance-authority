---
"@variance-authority/cli": patch
"@variance-authority/report": patch
---

An unattributed change is named by what is missing, not by how it was grouped

The `title` on the `shape only` marker in `variance report --format html` said the change was "grouped by silhouette alone", as though a change with a component were grouped by more. Every change is grouped by its fingerprint, a digest of the changed pixels that does not include the component. The marker now says that no region with that shape was attributed to a component.

In the same way, `variance adjudicate` and the `variance_adjudicate` MCP tool named an unclaimed change with no component "(no component resolved; grouped by shape alone)". The line reads "(no component resolved)".

The `@variance-authority/report` README said a change's fingerprint is built from the component responsible, so the same-looking change in two components stays two changes. It is built from the pixels alone: those two are one change, `accept --shape` on it promotes both, and `change.component` names the first component a region in it was attributed to. The `@variance-authority/tribunal` README's definition of a shape is corrected the same way.
