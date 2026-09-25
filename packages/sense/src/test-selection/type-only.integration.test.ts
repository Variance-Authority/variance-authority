import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { decodeTestCoverage } from './format.js';
import { narrowByExecution } from './index.js';

/**
 * A module of nothing but types is recorded from the file on disk.
 *
 * `shapes.ts` declares an interface and a type, and `area.ts` re-exports it, so
 * the module is loaded at runtime and the transform hands the seam an empty
 * text with an empty map. Recorded from that empty text, the digest matches no
 * commit, and every edit to the file — a comment included — reads as a stale
 * frame and charges every test that loaded it.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/type-only-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const shapes = named('src/shapes.ts');

let directory: string;
let coverageFile: string;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-type-only-'));
  coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory },
  });
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

describe('a module the transform leaves empty', () => {
  it('holds the premise: it was loaded, and loading it is the only region it has', async () => {
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    const row = coverage.modules.find((module) => module.file === shapes);
    expect(row?.blocks.map((block) => [block.kind, block.testFiles])).toEqual([
      ['module', [named('test/area.test.js')]],
    ]);
  });

  it('is recorded from the file on disk, every line of it', async () => {
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    const row = coverage.modules.find((module) => module.file === shapes);
    const text = readFileSync(resolve(repository, shapes), 'utf8');
    expect(row?.sourceDigest).toBe(digestString(text));
    expect(row?.blocks.map((block) => [block.startLine, block.endLine])).toEqual([[1, 7]]);
  });

  it('selects nothing for a comment, and does not call the frame stale', async () => {
    const narrowing = await narrowByExecution(
      coverageFile,
      await edit(shapes, '// The shapes every measure takes.', '// Every shape a measure takes.'),
      { sourceAt },
    );
    expect(narrowing.stale).toEqual([]);
    expect(narrowing.readings).toEqual([{ file: shapes, verdict: 'none', names: [] }]);
    expect(narrowing.entered).toEqual([]);
  });

  it('charges a statement it now runs as it loads to every test that loaded it', async () => {
    const narrowing = await narrowByExecution(
      coverageFile,
      await edit(shapes, 'export type Shape = Square;', 'export type Shape = Square;\n\nglobalThis.measured = true;'),
      { sourceAt },
    );
    expect(narrowing.stale).toEqual([]);
    expect(narrowing.entered).toEqual([named('test/area.test.js')]);
  });
});
