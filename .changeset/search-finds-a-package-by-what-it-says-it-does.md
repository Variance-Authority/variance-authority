---
"@variance-authority/help": minor
"@variance-authority/sense": minor
---

`variance ask search` finds an installed package by what it says it does

`variance ask search --query "state management"` lists, after the name matches, the installed packages that describe that job. When `variance index` refreshes the dependency lexicon, it stores the word stems each installed package uses: from its manifest `description` and `keywords`, its README headings, its package name, and its exported names with the first sentence of their documentation. A package is listed when those stems contain at least half of the distinct stems of the query. A package whose own description, keywords or headings contain them comes before one that matches only through its names. Each row gives the version, the manifest that offers the package and how it declares it, how many times the code imports it, the package's description, and the query words it matched. A question reads only the stored stems and opens no package. A dependency lexicon written before this release answers without these rows until the next `variance index` rewrites it.
