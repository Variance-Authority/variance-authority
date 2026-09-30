---
"@variance-authority/cli": minor
---

`variance review --format markdown` names the changed functions no case ran

The comment opens with up to five changed functions that no recorded case runs, and folds the rest: the places where no case ran, the cases that ran each changed function, and a Mermaid graph of the changed functions with an arrow from a test file only where its cases call into one. That graph replaces the diagram of test files and directories. When the record was taken before the change, the heading reads "What this change might do", and the cases listed are the ones that ran the changed lines as they stood then. In `--format json`, each changed region lists the test files and the cases that call it as `tests` and `called`, and `record` says which reading the review gives: `ran` or `before`. The text format is unchanged.
