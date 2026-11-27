"""The recorder `variance python` loads into pytest: which lines each test ran.

CPython owns the answer (`sys.monitoring`, PEP 669, 3.12 and later): a LINE
callback notes the line and returns DISABLE, so a line costs one event per
test, and `restart_events()` at each test boundary arms them again. Nothing is
decided here: a test's file is written as JSON under `VARIANCE_PYTHON_OUT`, for
sense's addon to cut onto the Python reader's regions.
"""

import json
import os
import sys
import time

import pytest

if sys.version_info < (3, 12):
    raise RuntimeError("variance python records with sys.monitoring, which Python 3.12 added")

_TOOL = sys.monitoring.PROFILER_ID + 1  # 3: the first id PEP 669 leaves free of its named tools
_ROOT = os.path.realpath(os.environ.get("VARIANCE_PYTHON_ROOT", os.getcwd())) + os.sep
_OUT = os.environ["VARIANCE_PYTHON_OUT"]

_lines = None
_owned = {}
_began = 0.0


def _on_line(code, line):
    if _lines is not None:
        name = _owned.get(code.co_filename)
        if name is None:
            real = os.path.realpath(code.co_filename)
            name = _owned[code.co_filename] = real if real.startswith(_ROOT) and "site-packages" not in real else ""
        if name:
            _lines.setdefault(name, set()).add(line)
    return sys.monitoring.DISABLE


def pytest_configure(config):
    sys.monitoring.use_tool_id(_TOOL, "variance")
    sys.monitoring.register_callback(_TOOL, sys.monitoring.events.LINE, _on_line)
    sys.monitoring.set_events(_TOOL, sys.monitoring.events.LINE)


def pytest_unconfigure(config):
    sys.monitoring.set_events(_TOOL, 0)
    sys.monitoring.free_tool_id(_TOOL)


@pytest.hookimpl(hookwrapper=True, tryfirst=True)
def pytest_runtest_protocol(item, nextitem):
    global _lines, _began
    _lines = {}
    _began = time.perf_counter()
    sys.monitoring.restart_events()
    try:
        yield
    finally:
        entered, _lines = _lines, None
        outcome = item.nodeid not in _failed
        os.makedirs(_OUT, exist_ok=True)
        stem = f"{os.getpid()}-{abs(hash(item.nodeid))}"
        with open(os.path.join(_OUT, stem + ".json"), "w", encoding="utf-8") as out:
            json.dump(
                {
                    "nodeid": item.nodeid,
                    "file": os.path.realpath(str(item.path)),
                    "passed": outcome,
                    "duration": (time.perf_counter() - _began) * 1000,
                    "lines": {file: sorted(lines) for file, lines in entered.items()},
                },
                out,
            )


_failed = set()


def pytest_runtest_logreport(report):
    if report.failed:
        _failed.add(report.nodeid)
