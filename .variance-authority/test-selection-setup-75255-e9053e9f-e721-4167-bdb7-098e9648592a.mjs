
import { afterAll, beforeAll, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const journalFormat = createRequire("file:///Users/marinakorzunova/dev/variance-authority/packages/sense/dist/test-selection/worker-source.js")('./journal-format.cjs');

const modules = new Map();
// A module `vi.resetModules` evaluates again resolves this again, and keeps
// what it counted before the reset: same name and block count, same counters.
globalThis.__VA__ = (id, count) => {
  let counters = modules.get(id);
  if (counters === undefined || counters.length !== count) {
    counters = new Uint32Array(count);
    modules.set(id, counters);
  }
  return counters;
};
const ambient = () => modules;
const fileModules = () => modules;

// What had run before the file's first test. The file is collected — its
// imports evaluated, its top level run — before any hook runs, so a function
// counted here ran as a consequence of loading, not of a test. Read off the
// ambient bucket, which is the only one that exists at this point: no case has
// opened a scope yet.
const loaded = new Map();
beforeAll(() => {
  for (const [id, counters] of ambient()) loaded.set(id, counters.slice());
});
afterAll(async () => {
  const testFile = expect.getState().testPath;
  if (!testFile) throw new Error('variance-authority could not identify the current Vitest file');
  const stamp = process.pid + '-' + randomUUID();
  await mkdir("/Users/marinakorzunova/.cache/variance-authority/test-selection/ac3eb2a3cc4efab3ba5623eddfc5a16d/.run-75255-e9053e9f-e721-4167-bdb7-098e9648592a", { recursive: true });
  await writeFile(
    "/Users/marinakorzunova/.cache/variance-authority/test-selection/ac3eb2a3cc4efab3ba5623eddfc5a16d/.run-75255-e9053e9f-e721-4167-bdb7-098e9648592a/" + stamp + '.va',
    journalFormat.encodeJournal(testFile, fileModules(), loaded),
  );
});