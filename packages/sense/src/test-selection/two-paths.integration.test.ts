import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relationsOfFiles, type Relations } from '@variance-authority/core/relate';
import { scanRelations } from '../scan.js';
import { narrowByExecution } from './index.js';

/**
 * A module reached twice is read for the names each path carries.
 *
 * `gauge.ts` imports `bounds.ts` twice: `unit` directly, and `LIMIT` through
 * `ceiling.ts`, which hands it on as `ceiling`. A change to `LIMIT` reaches
 * `gauge.ts` one import out carrying `LIMIT`, which it never reads, and two
 * imports out carrying `ceiling`, which `full` reads. `label` reads neither.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/two-paths-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const tests = (...names: string[]): string[] => names.map((name) => named(`test/${name}.test.js`));
const bounds = named('src/bounds.ts');

let directory: string;
let coverageFile: string;
let relations: Relations;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-two-paths-'));
  coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  relations = relationsOfFiles(await scanRelations({ root: repository, dirs: [relative(repository, fixture)] }));
}, 30_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** The recorded text is the file on disk: the recording was made from it a moment ago. */
const sourceAt = (file: string): string | undefined => {
  const path = resolve(repository, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};

/** The diff git writes for this edit, under the file's own name. */
async function edit(file: string, from: string, to: string): Promise<string> {
  const before = readFileSync(resolve(repository, file), 'utf8');
  expect(before).toContain(from);
  const after = resolve(directory, 'after.ts');
  await writeFile(after, before.replace(from, to));
  const diff = await execute('git', ['diff', '--no-index', '--', resolve(repository, file), after]).then(
    () => '',
    (error: { stdout: string }) => error.stdout,
  );
  return diff
    .split('\n')
    .map((line) => (line.startsWith('--- ') ? `--- a/${file}` : line.startsWith('+++ ') ? `+++ b/${file}` : line))
    .join('\n');
}

describe('a module reached by two importers', () => {
  it('charges a reader of the name the second path carries, and nothing that reads neither', async () => {
    const narrowing = await narrowByExecution(coverageFile, await edit(bounds, 'LIMIT = 10', 'LIMIT = 20'), {
      relations,
      sourceAt,
    });
    expect(narrowing.readings).toEqual([{ file: bounds, verdict: 'values', names: ['LIMIT'], unseen: [] }]);
    expect(narrowing.entered).toEqual(tests('full'));
    expect(narrowing.because.find((cause) => cause.test === tests('full')[0])?.via).toContainEqual(
      expect.objectContaining({ kind: 'reader', name: 'LIMIT', file: bounds, reader: named('src/gauge.ts') }),
    );
  });
});
