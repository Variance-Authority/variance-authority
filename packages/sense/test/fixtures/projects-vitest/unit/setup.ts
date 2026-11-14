import { isMainThread } from 'node:worker_threads';

// The unit project's setup file, which runs before each of its test files and no other.
(globalThis as { project?: string }).project = 'unit';

// A run killed after it selected and before it landed, as a cancelled runner
// kills it: the process that would land is Vitest's own, this thread's process
// under `threads`, the parent of this one under `forks`.
if (process.env['FIXTURE_KILL'] !== undefined) process.kill(isMainThread ? process.ppid : process.pid, 'SIGKILL');
