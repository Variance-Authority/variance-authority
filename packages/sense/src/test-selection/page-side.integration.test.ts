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
 * A module whose functions run in the page is loaded, never probed: a probe in
 * a function that crosses as text has no runtime on the far side. The run
 * still loaded it, and an edit to it reaches the tests that did.
 *
 * `harness.ts` and `world.ts` cross; `include` refuses them and `unprobed`
 * names them. `collector.test` reaches `harness.ts` through the probed
 * `collector.ts`, the crossing `world.ts` and the probed barrel `index.ts`;
 * `plain.test` loads none of them. `collector.ts` also imports the barrel
 * itself, for a value that is not the harness, the way the route collector
 * imports `@variance-authority/playwright` beside its own `world.ts`: a reading
 * of importers that meets it there first never reaches it again through
 * `world.ts`, so only the record can say the test loaded `harness.ts`.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/page-side-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const harness = named('src/harness.ts');
const world = named('src/world.ts');
const plain = named('src/plain.ts');

let directory: string;
let coverageFile: string;
let relations: Relations;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-page-side-'));
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

const select = async (diff: string) => narrowByExecution(coverageFile, diff, { relations, sourceAt });

describe('a module loaded but not probed', () => {
  it('selects the test that loaded it for an edit inside a function that crosses into the page', async () => {
    const narrowing = await select(await edit(harness, "'pageerror'", "'pageerrorx'"));
    expect(narrowing.entered).toEqual([named('test/collector.test.js')]);
  });

  it('selects it from the record alone, with no import graph to read', async () => {
    const narrowing = await narrowByExecution(coverageFile, await edit(harness, "'pageerror'", "'pageerrorx'"), {});
    expect(narrowing.entered).toEqual([named('test/collector.test.js')]);
  });

  it('selects the test that loaded it for an edit to a module only a crossing module imports', async () => {
    const narrowing = await select(await edit(world, "'title'", "'heading'"));
    expect(narrowing.entered).toEqual([named('test/collector.test.js')]);
  });

  // FIXME: a module read as text and run in the page (tools/page-agents.mjs bundles) is never loaded through the
  // runner, so nothing marks it and an edit to it selects nothing. Measuring it needs a record of which
  // bundle a test read and what went into it — a record-format or spec decision, not taken here.
  it.todo('selects the test that ran it in the page for an edit to code it reads as a bundle');

  it('still charges a probed module by its lines', async () => {
    const narrowing = await select(await edit(plain, "'plain'", "'plainer'"));
    expect(narrowing.entered).toEqual([named('test/plain.test.js')]);
  });
});
