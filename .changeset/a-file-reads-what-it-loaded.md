---
"@variance-authority/distill": minor
"@variance-authority/cli": minor
"@variance-authority/sense": minor
---

`variance distill --file <path>` without `--test` reads the whole test file: the
modules it loaded that no case entered, and those only some of its cases
entered, each with its length in lines. A runner evaluates a module once per
test file, so each of these is an import every case pays for at load time; a
mock, a deferred import or a `require` where the module is used can spare it.
`--file` alone used to read the file's only case; name it with `--test` for
that reading.

The reading needs the coverage rows of a recorded run, and is refused for a
case index named with `--execution`. A module that declares no function below
its top level, such as a barrel or a file of constants, is not counted.

`@variance-authority/distill` exports `distillFile` and
`formatFileDistillation`. `@variance-authority/sense/test-selection` exports
`decodeTestCoverage`, for a caller that already holds the record's bytes.
