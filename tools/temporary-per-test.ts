import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, type RunnerTask } from 'vitest';

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
 * So the file gets a directory of its own when this loads, and each test gets
 * one inside it before it runs. The module's top level and a `beforeAll` at the
 * top of the file write in the file's directory. A `beforeAll` inside a
 * `describe` that comes after a test writes in that test's directory, which is
 * still inside the file's. A process a test starts inherits the directory. The
 * only turn a test waits on is one it took on purpose.
 *
 * When the file ends, the variables are put back. That matters only in a run
 * without isolation (`--no-isolate`), where the same worker runs the next file,
 * and that file's directory would otherwise be made inside this one's. The
 * file's directory is then removed with everything its tests left in it, unless
 * a test or a hook failed, in which case it is kept, and named, as the evidence.
 */

const TEMPORARY = ['TMPDIR', 'TEMP', 'TMP'] as const;
const machine = TEMPORARY.map((name) => process.env[name]);

function temporaryAt(directory: string): void {
  for (const name of TEMPORARY) process.env[name] = directory;
}

function failed(task: RunnerTask): boolean {
  return task.result?.state === 'fail' || (task.result?.errors?.length ?? 0) > 0 ||
    ('tasks' in task && task.tasks.some(failed));
}

const file = mkdtempSync(join(tmpdir(), 'va-test-'));
temporaryAt(file);

// TODO: a test that starts a process with an environment built from scratch,
// without TMPDIR, TEMP and TMP, gives it the machine's temporary directory and
// the machine's index turn, and nothing refuses that — needs a check over the
// `env` every spawn in a test file is given.
beforeEach(() => {
  temporaryAt(mkdtempSync(join(file, 'case-')));
});

// TODO: a file whose every test is skipped, such as a browser-gated file on a
// machine without its browser, leaves its directory behind, because Vitest
// calls no `afterAll` there and the pool ends the worker without an `exit`
// event; the directory holds whatever the file's top level wrote under
// `tmpdir()` — needs a `globalSetup` teardown that removes what this run made.
afterAll((suite) => {
  TEMPORARY.forEach((name, at) => {
    const value = machine[at];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
  if (failed(suite)) {
    console.warn(`kept ${file}, what this file's tests left in their temporary directories, because a test failed`);
    return;
  }
  try {
    rmSync(file, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    // A test that failed before putting a mode back, or a process still
    // writing, is not a reason to fail a file whose tests passed.
    console.warn(`left ${file}, which could not be removed: ${error instanceof Error ? error.message : String(error)}`);
  }
});
