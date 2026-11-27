// compass: variance-authority.reach
/**
 * Run a pytest suite and land which Python functions each test ran.
 *
 * CPython counts the lines (`sys.monitoring`, 3.12 and later), so nothing is
 * placed: `python/variance_pytest.py` is loaded into pytest, writes the lines
 * each test ran, and the addon's `pythonCoverage` charges them to the Python
 * reader's functions. The journals land through the fold, which cuts each `.py`
 * file again from the checkout as it cuts a module.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { native } from '../addon.js';
import { writeJournals } from './case-journals.js';
import { finishedCase } from './case-durations.js';
import { whyAbsent } from './native-modules.js';
import { recordFileFor } from './record-location.js';
import { repositoryRoot } from './repository-root.js';
import { foldRun } from './selection-fold.js';
import { newRun } from './selection-run.js';

export interface PythonRun {
  /** Where pytest runs. */
  readonly cwd: string;
  readonly suite?: string | undefined;
  /** The record to write, in place of the suite's. */
  readonly coverageFile?: string | undefined;
  /** What follows `pytest`: the paths, markers and options to run. */
  readonly args?: readonly string[];
  /** The interpreter, `python3` unless given. */
  readonly python?: string | undefined;
}

/** What the plugin writes for one test. */
interface Written {
  readonly nodeid: string;
  readonly file: string;
  readonly passed: boolean;
  readonly duration: number;
  readonly lines: Readonly<Record<string, readonly number[]>>;
}

/**
 * Run `run`'s pytest suite with the recorder loaded, and fold what each test
 * ran into the suite's record. Answers how many tests failed.
 */
export async function recordPython(run: PythonRun): Promise<number> {
  const pythonCoverage = native()?.pythonCoverage;
  if (pythonCoverage === undefined) throw new Error(`recording a pytest suite requires the Sense native addon: ${whyAbsent('pythonCoverage')}`);
  const root = repositoryRoot(run.cwd);
  const coverageFile = recordFileFor(root, run.cwd, { suite: run.suite, coverageFile: run.coverageFile });
  const selection = newRun(coverageFile, root, 'presence');
  const fold = foldRun(selection, {
    coverageFile,
    shims: [],
    derive: true,
    unreached: 'No Python file of the checkout was entered: check that the tests run code under the repository root.',
  });
  const written = `${selection.runDirectory}-python`;
  rmSync(written, { recursive: true, force: true });
  mkdirSync(written, { recursive: true });
  try {
    const plugin = fileURLToPath(new URL('../../python', import.meta.url));
    const code = await exit(run.python ?? 'python3', ['-m', 'pytest', '-p', 'variance_pytest', ...(run.args ?? [])], run.cwd, {
      ...process.env,
      PYTHONPATH: [plugin, process.env['PYTHONPATH']].filter((path) => path !== undefined && path !== '').join(delimiter),
      VARIANCE_PYTHON_OUT: written,
      VARIANCE_PYTHON_ROOT: root,
    });
    const tests = readdirSync(written).map((name) => JSON.parse(readFileSync(join(written, name), 'utf8')) as Written);
    // Without a single test written, pytest failed before running any: its own output says why.
    if (tests.length === 0) throw new Error(`pytest ran no test (exit ${code}); the recorder wrote nothing`);
    const files = new Map<string, Written[]>();
    for (const test of tests) files.set(test.file, [...files.get(test.file) ?? [], test]);
    const finished = [];
    for (const [testFile, ran] of files) {
      const entered = pythonCoverage(ran.map((test) => Object.entries(test.lines).map(([file, lines]) => ({ file, lines: Uint32Array.from(lines) }))), root);
      writeJournals(selection, testFile, ran.map((test) => ({ name: test.nodeid })), entered);
      finished.push({
        filepath: testFile,
        complete: ran.every((test) => test.passed),
        cases: ran.map((test) => finishedCase(test.nodeid, undefined, test.duration)),
      });
    }
    await fold(finished);
    return tests.filter((test) => !test.passed).length;
  } finally {
    rmSync(written, { recursive: true, force: true });
  }
}

/** A process run with its output passed through: its exit code. */
function exit(program: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: 'inherit', env });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}
