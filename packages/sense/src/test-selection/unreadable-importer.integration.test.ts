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
import { taintRecords } from '../taint/index.js';
import { mockTaint } from '../taint/mocks.js';
import { narrowByExecution } from './index.js';

/**
 * An importer the parser cannot read is answered whole.
 *
 * `lib/` is outside the recording's `include`, so nothing under it has a row.
 * `relay.js` and `gate.js` are Flow: the build strips their annotations before
 * they run, and the parser, reading the committed text, cannot. Each re-exports
 * a value — `LIMIT` from `lib/limits.ts`, which has no row, and `MAX` from
 * `src/bounds.ts`, which has one — and a test reads it through the re-export.
 * `floor.test.js` loads `bounds.ts` and reads something else. `unit.test.js`
 * reads `unit` from `limits.ts`, which counts as moved: a file with no row
 * moves every name it exports. `mocked.test.js` imports `LIMIT` from a mock of
 * `relay.js`, so its run never loads the relay.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/unreadable-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const tests = (...names: string[]): string[] => names.map((name) => named(`test/${name}.test.js`));

let directory: string;
let coverageFile: string;
let relations: Relations;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-unreadable-'));
  coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  // As the CLI builds it: the mocks the scan read are joined as shadows.
  const records = await scanRelations({ root: repository, dirs: [relative(repository, fixture)] });
  const tainted = await taintRecords(records, [mockTaint()], { root: repository });
  relations = relationsOfFiles(tainted.records, { shadows: tainted.shadows });
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

describe('an importer with no row that cannot be read', () => {
  it('selects every test that loaded it, when the declaring file has no row either', async () => {
    const limits = named('lib/limits.ts');
    const narrowing = await narrowByExecution(coverageFile, await edit(limits, 'LIMIT = 10', 'LIMIT = 20'), {
      relations,
      sourceAt,
    });
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'values', names: ['LIMIT'] }]);
    expect(narrowing.entered).toEqual(tests('limit', 'unit'));
    expect(narrowing.because[0]?.via).toContainEqual({ kind: 'reader', name: 'LIMIT', file: limits, reader: named('lib/relay.js') });
  });

  it('leaves out a test that mocked it', async () => {
    const limits = named('lib/limits.ts');
    const narrowing = await narrowByExecution(coverageFile, await edit(limits, 'LIMIT = 10', 'LIMIT = 20'), {
      relations,
      sourceAt,
    });
    expect(narrowing.entered).not.toContain(tests('mocked')[0]);
  });

  it('selects every test that loaded it, and does not name them unseen, when the declaring file has a row', async () => {
    const bounds = named('src/bounds.ts');
    const narrowing = await narrowByExecution(coverageFile, await edit(bounds, 'MAX = 10', 'MAX = 20'), {
      relations,
      sourceAt,
    });
    expect(narrowing.readings).toEqual([{ file: bounds, verdict: 'values', names: ['MAX'], unseen: [] }]);
    expect(narrowing.entered).toEqual(tests('max'));
    expect(narrowing.because[0]?.via).toContainEqual({ kind: 'reader', name: 'MAX', file: bounds, reader: named('lib/gate.js') });
  });
});
