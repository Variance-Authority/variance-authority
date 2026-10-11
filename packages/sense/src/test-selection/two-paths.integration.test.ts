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
 *
 * A declaring file is a path to itself. `cap.ts` reads its own `LIMIT` through
 * `import * as self`, and `clamp.ts` reads its own `MAX` as `M`, imported back
 * from `most.ts`, which re-exports it. `meter.ts` reads its own `TOTAL` as
 * `sum` from `lib/sum.ts`, which the recording does not instrument, and `meter.test.js`
 * loads it by a specifier the scan cannot read.
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

describe('a declaring file that reads its own value through an import', () => {
  it('charges a read through a namespace import of itself', async () => {
    const cap = named('src/cap.ts');
    const narrowing = await narrowByExecution(coverageFile, await edit(cap, 'LIMIT = 10', 'LIMIT = 20'), {
      relations,
      sourceAt,
    });
    expect(narrowing.readings).toEqual([{ file: cap, verdict: 'values', names: ['LIMIT'], unseen: [] }]);
    expect(narrowing.entered).toEqual(tests('cap'));
  });

  it('charges a read under an alias, imported back from a file that re-exports it', async () => {
    const clamp = named('src/clamp.ts');
    const narrowing = await narrowByExecution(coverageFile, await edit(clamp, 'MAX = 10', 'MAX = 20'), {
      relations,
      sourceAt,
    });
    expect(narrowing.readings).toEqual([{ file: clamp, verdict: 'values', names: ['MAX'], unseen: [] }]);
    expect(narrowing.entered).toEqual(tests('clamp'));
  });

  it('still names a test that loaded it by an edge the graph lacks', async () => {
    const meter = named('src/meter.ts');
    const narrowing = await narrowByExecution(coverageFile, await edit(meter, 'TOTAL = 10', 'TOTAL = 20'), {
      relations,
      sourceAt,
    });
    expect(narrowing.readings).toEqual([{ file: meter, verdict: 'values', names: ['TOTAL'], unseen: tests('meter') }]);
    expect(narrowing.entered).toEqual(tests('meter'));
  });
});
