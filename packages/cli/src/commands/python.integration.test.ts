import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { runPython } from './python.js';

// `ci-info` decides CI once, when it loads, so the module is cut: these questions are asked outside CI.
vi.mock('ci-info', () => ({ isCI: false }));

const PYTHON = process.env['VARIANCE_PYTHON'] ?? 'python3';

/** Whether this machine can record: CPython 3.12 or later with pytest, which the recorder needs. */
function canRecord(): boolean {
  try {
    execFileSync(PYTHON, ['-c', 'import sys, pytest; sys.exit(sys.version_info < (3, 12))'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const FILES: Record<string, string> = {
  'pkg/__init__.py': '',
  'pkg/calc.py': 'def add(a, b):\n    return a + b\n\n\ndef mul(a, b):\n    return a * b\n',
  'tests/__init__.py': '',
  'tests/test_calc.py': 'from pkg.calc import add, mul\n\n\ndef test_add():\n    assert add(1, 2) == 3\n\n\ndef test_mul():\n    assert mul(2, 3) == 6\n',
};

const directories: string[] = [];
afterEach(() => void vi.unstubAllEnvs());
afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

/** The tests `covering` names for one function of `pkg/calc.py` in `root`. */
async function covering(root: string, name: string): Promise<string[]> {
  let out = '';
  await main(['covering', '--root', root, '--file', 'pkg/calc.py', '--function', name, '--format', 'json'], { out: (text) => (out += text), err: () => {} });
  return JSON.stringify(JSON.parse(out)).match(/tests\/test_calc\.py::\w+/g) ?? [];
}

describe.skipIf(!canRecord())('recording a pytest suite', () => {
  it('names, for each function, the tests that ran it and no other', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'variance-python-')));
    directories.push(root);
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    execFileSync('git', ['init', '-q'], { cwd: root });
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(root, '.cache'));
    const exit = await runPython({ command: 'python', args: ['-q'] }, root);

    expect(exit).toBe(0);
    expect([...new Set(await covering(root, 'add'))]).toEqual(['tests/test_calc.py::test_add']);
    expect([...new Set(await covering(root, 'mul'))]).toEqual(['tests/test_calc.py::test_mul']);
  });
});
