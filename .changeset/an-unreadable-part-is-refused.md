---
'@variance-authority/cli': patch
---

`variance share --publish` refuses a shard's part it cannot read

When a `report.suite-part.json` beside a shard's run report is there but cannot
be read, such as one in another format or version, the command publishes
nothing, exits 2, and names the part and why it cannot be read. It used to
report a defect in the tool and print a stack trace.
