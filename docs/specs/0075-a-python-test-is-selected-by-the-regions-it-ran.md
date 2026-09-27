# Spec 0075 — a Python test is selected by the regions it ran

**Missing:** a record of the regions each Python test ran, and a both-texts
verdict for a changed `.py` file. `variance reach` reads Python, resolving every
module path a statement could mean, and walks a changed file as a whole file.
No recorder writes a row for a pytest or unittest case. A Jest or Playwright
case that calls a Python service ends its journey at the HTTP boundary.
**Built on:** [ADR-0074](../context/adr/0074-one-reader-per-tree-sitter-language.md)
(the Python reader is the addon's),
[ADR-0069](../context/adr/0069-every-answer-has-an-owner.md) (CPython's
`sys.monitoring` is the owner of what ran),
[ADR-0072](../context/adr/0072-a-change-is-read-before-it-is-charged.md) (a
changed value is charged to its readers),
[ADR-0070](../context/adr/0070-a-journey-travels-as-trace-context.md),
[0073](0073-a-test-owns-the-files-its-services-ran.md) (the lane model), and
[0027](0027-a-test-is-selected-by-what-it-executed.md).

## Purpose

Python is the language where selection has the most tools and the most
research, and where they share one weakness: code that runs at import. Class
bodies, decorators, default arguments and module constants run once, when the
module is first imported, and are charged to whichever test imported it first
or to every test that touched the file. testmon puts all of it in one module
block, so a top-level edit reselects every test of the file. NameRTS measures
why that matters: the average test file imports 83% of the source files.

The instrument in `sense` already separates this for JavaScript: a load-time
hit is marked `EVALUATING` and recorded as `shared`, and a changed value is
charged one import deep to the functions that read it. This spec is the same
record for Python, on the probe CPython 3.12 added for exactly this use.

## Existing solutions

| Tool | Grain | How it records and selects | Source |
| --- | --- | --- | --- |
| pytest-testmon 2.2.0 | function body, plus one module block for everything else | coverage.py `switch_context` per test; CRC32 of AST blocks; a top-level edit selects every test of the file; tracks env vars and package versions; not network services | [github](https://github.com/tarpas/pytest-testmon) |
| coverage.py dynamic contexts | line or arc, per test | `dynamic_context = test_function` or `--cov-context=test`; no selection. Not supported under `core=sysmon`, which is the default on 3.14 | [docs](https://coverage.readthedocs.io/en/latest/contexts.html) |
| pytest-rts 2.5.0 | line | coverage contexts intersected with `git diff -U0`; comment edits select; dormant since 2021 | [github](https://github.com/WithSecureOpenSource/pytest-rts) |
| pytest-incremental, rut | module | static import graph | [github](https://github.com/pytest-dev/pytest-incremental) |
| pytest-picked | test file | changed test files only, no dependencies | [github](https://github.com/anapaulagomes/pytest-picked) |
| pytest-ekstazi | file, per test | `sys.settrace` around the test call only, SHA-1 per file; import time and fixtures not traced | [github](https://github.com/Igorxp5/pytest-ekstazi) |
| smother, nose-knows, pytest-knows, pytest-smartcollect | line to module | per-test tracing or static AST; all dormant since 2014–2018 | [smother](https://github.com/chrisbeaumont/smother) |
| Datadog Test Impact Analysis (dd-trace-py) | file by default, line optional; skips at file grain | its own collector on `sys.monitoring` with `DISABLE` and `restart_events()` per test; records import-time coverage per module and adds it to each test transitively; +1.5% file level and +3.7% line level over its previous collector, in a microbenchmark | [docs](https://docs.datadoghq.com/tests/test_impact_analysis/setup/python/), [PR 20501](https://github.com/DataDog/dd-trace-py/pull/20501) |
| CircleCI Smarter Testing | file | `--cov-context=test`, a content hash per file; says coverage across services "is not straightforward" | [docs](https://circleci.com/docs/guides/test/set-up-test-impact-analysis) |
| SeaLights Python agent | not documented | a shared `SL_LABID` across every process of a test environment; the only product documenting a separate Python service | [docs](https://pypi.org/project/sealights-python-agent/) |
| Teamscale | aggregate for Python | coverage.py to LCOV; test-wise only for Java and .NET | [docs](https://docs.teamscale.com/howto/setting-up-profiler-tga/python/) |
| CloudBees Smart Tests | — | a model over history and change similarity, no coverage | [blog](https://www.cloudbees.com/blog/how-cloudbees-smart-tests-works) |

## Research

- Wang, Pradel, Liu,
  [*Names Are All You Need: Effective and Safe Regression Test Selection for Python*](https://arxiv.org/abs/2605.25356),
  ISSTA 2026. A bipartite graph of code elements and names; elements compared by
  a checksum of normalized bytecode; module and class elements for import-time
  effects; registry decorators instrumented at runtime. On 500 commits of 10
  projects it skips 69.9% of test files and 45.6% of time, safe on 498 of 500
  commits, with 10.0% end-to-end overhead. It does not evaluate testmon.
- Maurina, Cazzola, Ghosh,
  [*BabelRTS: Polyglot Regression Test Selection*](https://ieeexplore.ieee.org/document/10944548/),
  TSE 51(5), 2025. Static, file grain, language-agnostic; per NameRTS, 28.4%
  skipped and safe on 76.6% of commits.
- Kauhanen, Nurminen, Mikkonen, Pashkovskiy,
  [*Regression Test Selection Tool for Python in Continuous Integration Process*](https://researchportal.helsinki.fi/en/publications/regression-test-selection-tool-for-python-in-continuous-integrati),
  VST at SANER 2021. The pytest-rts paper: 0–2% of mutants missed at file grain,
  16–24% at line grain.
- Altmayer Pizzorno, Berger,
  [*SlipCover: Near Zero-Overhead Code Coverage for Python*](https://arxiv.org/abs/2305.02886),
  ISSTA 2023. Not selection: removing a probe once it fires costs a median 5%,
  against coverage.py's 180%.
- [PEP 669](https://peps.python.org/pep-0669/): "Coverage tools can be
  implemented at very low cost, by returning DISABLE in all callbacks." A
  disabled location stays off until `sys.monitoring.restart_events()`, which is
  global.

No peer-reviewed study evaluates pytest-testmon.

## What would discharge it

**1. A both-texts verdict for Python.** Regions are a module body, a class body,
a function, a lambda, an `if`/`elif`/`else` arm, a `match` case, a loop body, an
`except` handler and a `with` body, each identified by its address in the tree
and a digest of its own text. `none` for comments and formatting; a docstring is
a value and is `values`, because `__doc__` can be read. `bodies` for edits
inside functions. `values` for a changed module constant, class attribute,
default argument or decorator argument, charged to the functions that read it.
`load` for a changed import, a decorator itself, a metaclass or an
`if TYPE_CHECKING:` `else` branch.

**2. The recorder rides `sys.monitoring`.** It claims its own tool id, listens
for `PY_START`, `BRANCH` (`BRANCH_LEFT` and `BRANCH_RIGHT` on 3.14) and `LINE`,
and returns `DISABLE` from every callback, so a location costs one event per
test. Events map to regions through the code object's positions, read once per
code object and carried, never re-derived from source text at the far end. At a
test boundary it calls `restart_events()`. A second tool that shares the
interpreter, such as coverage.py, is detected, and the recorder then re-arms per
code object instead, as dd-trace-py does. Python 3.11 and earlier are out of
scope.

**3. Import time is recorded as `shared`, not charged to one test.** A module
body, a class body and a decorator run under the import that first loaded them.
Those events are marked as load-time, the same `EVALUATING` distinction the
JavaScript instrument makes, and `sys.modules` caching is the warmth key 0073
describes: `alone` is one test per interpreter. A change to load-time code is
answered by the `values` verdict, not by who imported first.

**4. The seam is a pytest plugin and a unittest runner.** The boundary is
`pytest_runtest_protocol`, which brackets setup, call and teardown, so fixtures
are the test's. `pytest-xdist` workers are processes, each with its own
monitoring state, which is safe. Threads a test leaves running and
`asyncio` tasks it leaves pending are reported by name at its end.

**5. A Python service is a journey participant.** A service runs under the
recorder in a lane, as in 0073. The id arrives as a `baggage` member or an
OpenTelemetry trace id, which Django, Flask and FastAPI instrumentation already
reads; the service's part is a VAREC inventory under a Python recipe, which the
native fold reads under any recipe. `multiprocessing` children inherit the
recorder through the start method.

**6. Measured against testmon and NameRTS on their own ground.** Some of NameRTS's
10 projects are replayed commit by commit with its ground truth, and
testmon runs on the same commits, with seeded faults as in
[`jvm/measure`](../../jvm/measure/README.md). The recording cost is measured
against a bare `pytest` run and against `coverage run` with `core=sysmon`.

## Acceptance

1. A comment or formatting edit selects nothing. An edit inside one function
   selects only the tests whose rows name its regions.
2. A changed module constant selects the tests that ran a function reading it,
   and not every test that imported the file.
3. A changed decorator or metaclass selects every test of every module that
   applies it.
4. The test that imports a module first and the test that imports it second get
   the same row for its load-time regions.
5. A Python service in a lane, called from a Jest or Playwright case, adds its
   regions to that case's journey.
6. The replay reports tests run, faults missed and recording cost for this
   selector, testmon and NameRTS's published figures.

## Boundary

C extensions and Cython are recorded as the calling region. Code built with
`exec` or `eval` has no file to change, and the code that builds it does. PyPy
has no `sys.monitoring` and is not supported.
