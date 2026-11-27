# Select Python tests from the functions each one ran

`variance python` runs a pytest suite with a recorder loaded and records which
functions each test ran. A change to a Python function then runs only the test
files whose tests ran it, and `variance covering` names the tests that ran any
function you ask about.

CPython reports the lines itself, through `sys.monitoring` (PEP 669), so the
source is never rewritten and no `coverage` package is installed. A line costs one
event per test: the recorder disarms it once seen and arms it again at the next
test. It needs CPython 3.12 or newer and pytest.

## Record a pytest suite

The CLI is a Node package, so you need Node 22.12 or newer. Install it at the
repository root:

```bash
npm install --save-dev @variance-authority/cli
```

Then, from the directory pytest runs in:

```bash
npx variance python --suite unit
```

`unit` is a suite you name under `suites` in `variance.config.json` at the
repository root, as `{ "suites": { "unit": { "kind": "unit" } } }`. What follows
`--` goes to `pytest`: the paths, markers and options to run.

```bash
npx variance python --suite unit -- tests/ -q
```

The command:

- runs pytest once, with the recorder loaded as a plugin, so tests share one
  process as pytest runs them;
- writes the suite's [execution record](execution-record.md), as every other
  runner does: one row per test file, one case per pytest node id.

It exits `0` when every test passed and `1` when one failed. Ask what ran a
function:

```bash
npx variance covering --file pkg/calc.py --function add
```

```text
1 named test covered function add of pkg/calc.py:
  tests/test_calc.py — 1/2
    tests/test_calc.py::test_add
```

After you change a function, name the tests to run:

```bash
npx variance select --suite unit --since origin/main
```

It names the test files whose tests ran a function you changed, and skips the
rest.

Record the whole suite. A run narrowed with `-k` or `-m` records only the tests
it ran, yet takes their files as finished, so the tests it left out stop being
selected.

All tests share one pytest process, so what pytest runs once for many tests is
charged to the first test that ran it. A fixture with `session` or `package`
scope, and a function cached across test files, such as one under
`functools.cache`, run under the first test that needs them, and only that test
is charged: an edit to one can leave out the other test files that use it. Name the file that
holds one in the suite's `before`, below, so an edit to it runs every test.

No test reads `pyproject.toml`, `requirements.txt`, a lockfile or `pytest.ini`,
and the record holds none of them, so a change to one keeps no test in the run.
Name them in the suite's
[`before`](changes-before-and-beyond.md#how-a-change-before-reach-is-declared)
to run every test when one changes:

```json
{ "suites": { "unit": { "kind": "unit", "before": ["pyproject.toml", "requirements.txt"] } } }
```

## What a function is

A function, method or nested function is a region of its own, named by its
scope, such as `Calc/twice/inner`. A class adds a scope and is not a region; a
lambda and a decorator belong to the function they are written in. The code a
module runs as it is imported belongs to the module's root, and a test that ran
any function of a file is charged the root too: import-time code runs once, while
pytest collects the test files, so an edit to it selects every test
that ran the file. A test that ran none of the file's functions and only read a
value its top level set, such as a constant, is not charged, and an edit to that
value can leave it out. Name a module that tests read that way in the suite's
`before`.

A file pytest imports from outside the repository root, or from `site-packages`,
is not recorded.
