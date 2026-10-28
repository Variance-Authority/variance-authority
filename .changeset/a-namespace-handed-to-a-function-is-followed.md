---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance ask uses` follows a module held whole, `import * as ns` or `const ns = await import(…)`, into a function the same file declares when the module is handed to it, `f(ns)`, and lists the names that function reads off its parameter at the lines that read them. Such a call no longer marks every name of the module "passed on whole: may read it". That mark now names the line where the module leaves the file's sight, which may be inside the function. A read off the parameter is no longer called type-only because the parameter's type is `typeof import(…)`. The source index format moves to 36, so the next scan reads every file again.
