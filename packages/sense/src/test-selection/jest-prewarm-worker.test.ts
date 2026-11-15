import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import worker from './jest-prewarm-worker.cjs';

const require = createRequire(import.meta.url);

const resolver = require.resolve('jest-resolve');
// Jest loads a file as an ES module only under `--experimental-vm-modules`, which
// jest-resolve reads from `vm` when it loads; the warming child inherits the flag
// from the run, as its test workers do. This one stands in for such a process.
const withoutVmModules = (vm as { SyntheticModule?: unknown }).SyntheticModule === undefined;

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-prewarm-worker-'));
  if (withoutVmModules) Object.assign(vm, { SyntheticModule: class {} });
  delete require.cache[resolver];
});
afterAll(async () => {
  if (withoutVmModules) delete (vm as { SyntheticModule?: unknown }).SyntheticModule;
  delete require.cache[resolver];
  await rm(directory, { recursive: true, force: true });
});

describe('a warming worker', () => {
  it('leaves to Jest a file Jest loads as an ES module, whose transform takes other options', async () => {
    await mkdir(resolve(directory, 'esm'));
    await writeFile(resolve(directory, 'esm/package.json'), '{"type":"module"}');
    await writeFile(resolve(directory, 'esm/module.js'), 'export const a = 1;');
    await writeFile(resolve(directory, 'common.js'), 'exports.a = 1;');
    const log = resolve(directory, 'transformed.json');
    // A transformer that writes down what it was handed, in place of the project's.
    const transform = resolve(directory, 'transform.cjs');
    await writeFile(transform, `
      const fs = require('node:fs');
      exports.createScriptTransformer = async () => ({
        transform(file) {
          const seen = fs.existsSync(${JSON.stringify(log)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(log)}, 'utf8')) : [];
          fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify([...seen, file]));
        },
      });
    `);
    const files = [resolve(directory, 'esm/module.js'), resolve(directory, 'common.js')];

    const warmed = await worker.warm({ transform, resolve: resolver, config: {}, coverage: {}, files });

    expect(warmed).toBe(1);
    expect(JSON.parse(await readFile(log, 'utf8'))).toEqual([resolve(directory, 'common.js')]);
  });
});
