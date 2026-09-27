import { existsSync } from 'node:fs';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { removeSeamModules, writeSeamModule } from './selection-run.js';

// A read-only parent is how a directory is refused here, and permission bits
// bind neither the superuser nor Windows: there, nothing refuses.
const refuses = process.platform !== 'win32' && process.getuid?.() !== 0;

let project: string;

beforeEach(async () => {
  project = await mkdtemp(resolve(tmpdir(), 'variance-authority-seam-'));
});

afterEach(async () => {
  await chmod(resolve(project, 'locked'), 0o755).catch(() => undefined);
  await rm(project, { recursive: true, force: true });
});

it.runIf(refuses)('goes on past a directory it made that the platform will not let go of, and takes it off on a later call', async () => {
  const run = { made: new Set<string>() };
  const shim = writeSeamModule(run, resolve(project, 'locked', '.variance-authority', 'setup.mjs'), '');
  await chmod(resolve(project, 'locked'), 0o555);

  expect(() => removeSeamModules(run, [shim])).not.toThrow();
  expect(existsSync(shim)).toBe(false);
  expect(existsSync(dirname(shim))).toBe(true);

  await chmod(resolve(project, 'locked'), 0o755);
  removeSeamModules(run, []);
  expect(existsSync(resolve(project, 'locked'))).toBe(false);
  expect(existsSync(project)).toBe(true);
  expect(run.made).toEqual(new Set());
});
