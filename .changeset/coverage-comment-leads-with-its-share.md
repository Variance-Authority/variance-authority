---
"@variance-authority/cli": patch
---

`variance coverage --format markdown` leads with the share of loaded regions that ran, with an arrow and the change in points when there is a base. The table of what the regions the suites loaded ran has a share column and a mark per row (🟢 run, 🟡 one kind alone, ⚪ only at load, 🔴 no suite). The source line states its share first; the files no suite recorded, by directory, and the test files whose regions changed most are folded under summaries that count them. A suite with no base is printed as a note. The text format is unchanged.
