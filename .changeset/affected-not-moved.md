---
'@variance-authority/core': minor
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`@variance-authority/core/relate` exports are renamed, and the old names are removed

The old names are removed, not kept as aliases:

| Was | Is |
|---|---|
| `movedBy` | `affectedBy` |
| `Reached` | `Affected` |
| `MovedOptions` | `AffectedOptions` |
| `movedBefore` | `changedBefore` |
| `Reach` | `Traversal` |
| `ReachOptions` | `TraversalOptions` |
| `Reach.reached` | `Traversal.nodes` |
| `Reached.reach` | `Affected.traversal` |

`dependentsOf` and `dependenciesOf` return a `Traversal`, and `trailOf` takes
one as its argument.
