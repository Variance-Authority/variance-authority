---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/package': minor
---

The questions are published by the native addon, with no name or use passing through JavaScript

`variance index` publishes the questions in one native call, `HelpReading.publish`. It joins each opening's names with the uses that reach them, reads every README a mention needs once and in parallel, and encodes the store from what it already holds. Before, the addon handed every use and every declaration over to JavaScript to be joined, and JavaScript handed the result back to be encoded. `HelpReading.usage`, `names` and `encode` are gone, along with the `HelpEncode` type; `PublishedName` and `ReachedDeclaration` stay in `@variance-authority/sense` as the shapes the walk hands to the join. The published store is byte-identical. The `reading the signatures and comments of the exported names` step is now part of `publishing the questions`.

The walk with no index, `readHelp`, moves from `@variance-authority/package/help` to `@variance-authority/help` and runs the same native join, so the rule is written once. `assembleHelp`, `reachedFrom`, `passedOn`, `readMention` and `readmes` leave `@variance-authority/package/help`; a README mention is read by `readmeMention` in `@variance-authority/sense`.
