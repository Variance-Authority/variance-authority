---
'@variance-authority/help': patch
---

When a package's candidate files overflow one page of `ask search --map`, the page groups them by the next directory and lists the files sitting directly in it. Before, it split them by one more character per drill. Files that all sit in one directory still split by name.
