import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach } from 'vitest';

/**
 * Every test gets a temporary directory of its own, set through the variables
 * `tmpdir()` already reads: TMPDIR on POSIX, and TEMP, then TMP, on Windows.
 *
 * The temporary directory is shared by every process this user runs, and the
 * product keeps one thing there on purpose: `variance index` takes the
 * machine's index turn at a fixed path under it
 * (`packages/sense/src/index-turn.ts`), so that two checkouts do not index at
 * once. With the machine's directory, a test that indexes waits whenever
 * another test file, or the developer's own `variance index`, holds that turn,
 * and the recording credits the test with the waiting path. Which test waited
 * was decided by scheduling, so the recording, and every selection read from
 * it, was decided by scheduling too.
 *
 * So the file gets a directory of its own when this loads, which is where a
 * module's top level and a `beforeAll` write, and each test gets one inside it
 * before it runs. A process a test starts inherits it. The only turn a test
 * waits on is one it took on purpose. The variables are put back when the file
 * ends, for a worker that runs another file after this one.
 */

const TEMPORARY = ['TMPDIR', 'TEMP', 'TMP'] as const;
const machine = TEMPORARY.map((name) => process.env[name]);

function temporaryAt(directory: string): void {
  for (const name of TEMPORARY) process.env[name] = directory;
}

const file = mkdtempSync(join(tmpdir(), 'va-test-'));
temporaryAt(file);

beforeEach(() => {
  temporaryAt(mkdtempSync(join(file, 'case-')));
});

afterAll(() => {
  TEMPORARY.forEach((name, at) => {
    const value = machine[at];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
});
