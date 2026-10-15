---
"@variance-authority/sense": patch
---

Read the projects a governing `tsconfig` references one level deep, the way `oxc-resolver` does, so a monorepo whose packages reference each other is not walked whole, and a reference cycle no longer overflows the stack. A project that references itself adds no custom conditions, as `oxc-resolver` refuses it.
