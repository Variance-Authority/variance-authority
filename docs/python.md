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

## What a function is

A function, method or nested function is a region of its own, named by its
scope, such as `Calc/twice/inner`. A class adds a scope and is not a region; a
lambda and a decorator belong to the function they are written in. The code a
module runs as it is imported belongs to the module's root, and a test that ran
any function of a file is charged the root too: import-time code runs once,
under whichever test imported the file first, so an edit to it selects every test
that ran the file.

A file pytest imports from outside the repository root, or from `site-packages`,
is not recorded.
