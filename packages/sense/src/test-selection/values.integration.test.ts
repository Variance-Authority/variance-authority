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
 * A change is charged by what it does, read from both texts, not by the lines
 * it sits on.
 *
 * `limits.ts` declares `LIMIT` and `STEP` at the top level. Inside it, `clamp`
 * reads `LIMIT` and `render` reads it through `DEFAULTS`. Three files import it:
 * `slider.ts` under another name, `meter.ts` as a namespace read by member, and
 * `registry.ts` as a namespace handed on whole. `step.test` reads `STEP` as it
 * loads. `label` and `unit` load an importer and call nothing that reads a
 * value, and `retries.ts` reads its own value in a call made at load.
 *
 * Every test but `attempts` crossed the top level of `limits.ts`, which is the
 * region a line-mapped reading charges for any edit up there. Each case below
 * names the tests that ran something the edit changed, and no others.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/values-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const tests = (...names: string[]): string[] => names.map((name) => named(`test/${name}.test.js`));
const limits = named('src/limits.ts');
const slider = named('src/slider.ts');
const retries = named('src/retries.ts');

let directory: string;
let coverageFile: string;
let relations: Relations;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-values-'));
  coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory },
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
const everyLoader = tests('clamp', 'count', 'fill', 'label', 'render', 'slide', 'step', 'unit');

describe('a change read from both of its texts', () => {
  it('holds the premise: without a reading, a top-level edit is charged to every test that loaded the file', async () => {
    const charged = await narrowByExecution(coverageFile, await edit(limits, 'LIMIT = 10', 'LIMIT = 20'), {
      relations,
    });
    expect(charged.readings).toEqual([{ file: limits, unread: 'source' }]);
    expect(charged.entered).toEqual(everyLoader);
  });

  it('selects nothing for a comment', async () => {
    const narrowing = await select(await edit(limits, '// The bounds every control shares.', '// Shared bounds.'));
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'none', names: [] }]);
    expect(narrowing.entered).toEqual([]);
  });

  it('selects nothing for a doc comment added above a function', async () => {
    // The new lines sit between two declarations, where the only region is the
    // module's own, and a line-mapped reading charges them to every loader.
    const opening = 'export function render(): string {';
    const documented = `/**\n * Reads the bound through \`DEFAULTS\`.\n *\n * @returns the label a control shows.\n */\n${opening}`;
    const narrowing = await select(await edit(limits, opening, documented));
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'none', names: [] }]);
    expect(narrowing.entered).toEqual([]);
  });

  it('charges a doc comment added beside a changed body to nothing but the body', async () => {
    const opening = 'export function render(): string {';
    const documented = `/**\n * Reads the bound through \`DEFAULTS\`.\n */\n${opening}`;
    const before = readFileSync(resolve(repository, limits), 'utf8');
    const narrowing = await select(
      await edit(limits, before, before.replace(opening, documented).replace('Math.min', 'Math.max')),
    );
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'bodies', names: [] }]);
    expect(narrowing.entered).toEqual(tests('clamp'));
  });

  it('charges a function body to the tests that entered it', async () => {
    const narrowing = await select(await edit(limits, 'Math.min(value, LIMIT)', 'Math.max(value, LIMIT)'));
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'bodies', names: [] }]);
    expect(narrowing.entered).toEqual(tests('clamp'));
  });

  it('charges a new export only where the namespace is handed on whole', async () => {
    // Nothing names `wrap` yet. `registry.ts` hands every name `limits.ts`
    // exports to whoever reads `known`, the new one included, so `count` is
    // the one reader of it.
    const added = 'export function wrap(value: number): number {\n  return value % LIMIT;\n}\n\nexport function clamp';
    const narrowing = await select(await edit(limits, 'export function clamp', added));
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'values', names: [], unseen: [] }]);
    expect(narrowing.entered).toEqual(tests('count'));
  });

  it('selects nothing for a new function nothing exports', async () => {
    const added = 'function wrap(value: number): number {\n  return value % LIMIT;\n}\n\nexport function clamp';
    const narrowing = await select(await edit(limits, 'export function clamp', added));
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'bodies', names: [] }]);
    expect(narrowing.entered).toEqual([]);
  });

  it('charges a line inserted inside a function to the tests that entered it', async () => {
    // The control for the one above: the same insertion one line lower, where
    // a region holds both sides of the gap.
    const opening = 'export function clamp(value: number): number {\n';
    const narrowing = await select(await edit(limits, opening, `${opening}  if (value < 0) return 0;\n`));
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'bodies', names: [] }]);
    expect(narrowing.entered).toEqual(tests('clamp'));
  });

  it('charges every test that loaded the file when a call is added at load', async () => {
    const narrowing = await select(await edit(limits, 'export const STEP = 2;', 'export const STEP = 2;\nconsole.log(STEP);'));
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'load', names: [] }]);
    expect(narrowing.entered).toEqual(everyLoader);
  });

  it('charges a moved value to every place that reads it, and to nothing that only loaded it', async () => {
    const narrowing = await select(await edit(limits, 'LIMIT = 10', 'LIMIT = 20'));
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'values', names: ['LIMIT'], unseen: [] }]);
    // `clamp` reads it; `render` reads `DEFAULTS`, which holds it; `slide` reads
    // it as `max`; `fill` reads `limits.LIMIT`; `count` loads a module that
    // hands the whole namespace on, where no name can follow it. `label` and
    // `unit` loaded an importer and never read the value, and `step` read
    // another name of the same file.
    expect(narrowing.entered).toEqual(tests('clamp', 'count', 'fill', 'render', 'slide'));
  });

  it('says where each moved value was read', async () => {
    const narrowing = await select(await edit(limits, 'LIMIT = 10', 'LIMIT = 20'));
    const via = (name: string) => narrowing.because.find((cause) => cause.test === tests(name)[0])?.via;
    expect(via('slide')).toContainEqual(
      expect.objectContaining({ kind: 'reader', name: 'LIMIT', file: limits, reader: slider }),
    );
    expect(via('fill')).toContainEqual(
      expect.objectContaining({ kind: 'reader', name: 'LIMIT', file: limits, reader: named('src/meter.ts') }),
    );
  });

  it('selects the test file that reads a moved value as it loads', async () => {
    const narrowing = await select(await edit(limits, 'STEP = 2', 'STEP = 3'));
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'values', names: ['STEP'], unseen: [] }]);
    expect(narrowing.entered).toEqual(tests('count', 'step'));
  });

  it('charges the module when a moved value is read by a call made at load', async () => {
    // `attempts` reads nothing, and its test is selected because the module
    // it loaded passed the value to `configure` as it loaded.
    const narrowing = await select(await edit(retries, 'RETRIES = 3', 'RETRIES = 4'));
    expect(narrowing.readings).toEqual([{ file: retries, verdict: 'values', names: ['RETRIES'], unseen: [] }]);
    expect(narrowing.entered).toEqual(tests('attempts'));
  });

  it('charges every test that loads an importer of a name the file stopped exporting', async () => {
    // An import of a name the module does not export is a link error in an ES
    // module, so `label` is charged although it calls nothing that reads it; a
    // runner that binds lazily lets it pass, and the charge follows the
    // language rather than the runner. `meter.ts` imports the namespace, which
    // still links, and only `fill` reads the missing member.
    const narrowing = await select(await edit(limits, 'export const LIMIT = 10;', 'const LIMIT = 10;'));
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'values', names: [], unseen: [] }]);
    expect(narrowing.entered).toEqual(tests('count', 'fill', 'label', 'slide'));
  });

  it('selects the tests that import a renamed export, and nothing that never named it', async () => {
    const narrowing = await select(await edit(limits, 'export const STEP = 2;', 'export const STRIDE = 2;'));
    expect(narrowing.entered).toEqual(tests('count', 'step'));
  });

  it('charges a name added to an import to the function that uses it', async () => {
    const diff = await edit(
      slider,
      "import { LIMIT as max } from './limits';\n\nexport function slide(value: number): number {\n  return value > max ? max : value;",
      "import { LIMIT as max, STEP } from './limits';\n\nexport function slide(value: number): number {\n  return value > max ? max : value + STEP;",
    );
    const narrowing = await select(diff);
    expect(narrowing.readings).toEqual([{ file: slider, verdict: 'bodies', names: [] }]);
    expect(narrowing.entered).toEqual(tests('slide'));
  });
});

it.todo(
  'a call that throws while binding a destructured first parameter is charged when a default is added to it — needs the probe in front of an object pattern, which runners that read fixture names from the source refuse',
);
