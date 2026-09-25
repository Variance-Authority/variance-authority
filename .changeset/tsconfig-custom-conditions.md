---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A file resolves under the `customConditions` of the `tsconfig` that governs it, added to `source`, `import`, `require` and `default`. A workspace whose packages export source under a condition of their own, such as `"@tanstack/custom-condition": "./src/index.ts"` beside an `import` that names built output the checkout does not hold, now has edges into that source, so `variance reach` walks from a changed package into the packages that import it. `extends` is followed the way TypeScript follows it: a config that sets the option replaces what it inherits, and `null` or `[]` clears it. A named `tsconfig` supplies its own conditions, and `conditionNames` you pass stay the whole set. Stored records are read again once, because the conditions a record was resolved under are part of its key.
