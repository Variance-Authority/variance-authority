---
"@variance-authority/distill": minor
"@variance-authority/cli": minor
"@variance-authority/sense": minor
---

`variance distill --file <path>` without `--test` reads the whole test file: the
modules it loaded before its first case that no case entered, and those only
some of its cases entered, each with its length in lines. A runner evaluates a
module once per test file, so every case pays for each of these at load time.
The fix is at the import that brought a module in, in the test file or a module
it used, not a mock of the listed path.
`--file` alone used to read the file's only case; name it with `--test` for
that reading.

The reading needs the coverage rows of a recorded run, and is refused for a
case index named with `--execution`. It reads as unmeasured when a case
stopped or did not say whether it finished, or when the file's coverage row is
incomplete, as it is once source changed since the run; run the file again. A
module that declares no function below
its top level, such as a barrel or a file of constants, is not counted.

`@variance-authority/distill` exports `distillFile` and
`formatFileDistillation`. `@variance-authority/sense/test-selection` exports
`decodeTestCoverage`, for a caller that already holds the record's bytes.
