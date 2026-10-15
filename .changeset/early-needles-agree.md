---
"@variance-authority/sense": patch
---

Read the projects a governing `tsconfig.json` references one level deep, the way `oxc-resolver` does, so a workspace whose packages reference each other is not walked whole to find a file's `customConditions`, and a reference cycle no longer overflows the stack. A project that references itself, or references a project that is not there, adds no custom conditions, as `oxc-resolver` refuses both.
