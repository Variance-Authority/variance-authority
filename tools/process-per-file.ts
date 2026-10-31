import { afterAll } from 'vitest';

/**
 * A test file ends with the process as it found it: the working directory and
 * every environment variable.
 *
 * A file that changes either — `process.chdir` into a fixture, a cache of its
 * own in `VARIANCE_AUTHORITY_CACHE` — puts it back when it is done, as a rule,
 * and does not when a test throws first or when its own hook deletes what the
 * config set. With a process per file that went unseen. A worker that keeps its
 * modules across files (`isolate: false`, the isolator resetting what they
 * hold) runs the next file in the same process, and that file starts in a
 * directory the last one removed, reading a cache nobody meant it to.
 *
 * This is the first setup file, so its `afterAll` runs after every other one,
 * once the file's own hooks have put back what they will.
 */

const cwd = process.cwd();
const env = { ...process.env };

afterAll(() => {
  if (process.cwd() !== cwd) process.chdir(cwd);
  for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name];
  for (const [name, value] of Object.entries(env)) if (process.env[name] !== value) process.env[name] = value;
});
