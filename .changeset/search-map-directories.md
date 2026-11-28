---
'@variance-authority/help': patch
---

When a package's candidate files overflow one page of `ask search --map`, the page groups them by the next directory and lists the files sitting directly in it. Before, it split them by one more character per drill. Files that all sit in one directory still split by name.

With no `--limit`, a map page now holds as many groups as fit its text, up to 50. Before, a page of 50 long groups was refused as over the text budget.
