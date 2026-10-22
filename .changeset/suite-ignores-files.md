---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

A suite in `variance.config.json` can list `ignore` globs. A changed file that matches selects none of that suite's tests by its regions, imports or `before` — only a test that declared it, as a precondition or through a `/// <depends>`, still runs — and `variance select` lists it as `ignored`. A `!` glob takes a file back out. This lets a unit suite under jsdom skip changed stylesheets and images, such as `"ignore": ["**/*.css", "**/*.png"]`, while a visual suite over the same components still selects on them.
