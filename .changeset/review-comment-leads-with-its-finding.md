---
"@variance-authority/cli": patch
---

`variance review --format markdown` leads with what the table adds up to, as a GitHub alert: a warning when changed regions have no case that covers them, a note when some are covered only from further away, a tip when every one is covered by a test that imports its file. The changed-regions table marks each row (🟢 near, 🟡 far, 🟠 unplaced, ⚪ loaded, 🔴 no case) and ends with a total row. A line says how many of the suite's test files ran at this commit and names `variance select --since <ref>`, which lists the files a change reaches. The edits, the cases, the files not in the record, the cases changed against the base and each changed file are folded under summaries that count them. The text format is unchanged.
