import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relationsOfFiles, type Relations } from '@variance-authority/core/relate';
import { scanRelations } from '../scan.js';
import { narrowByExecution } from './index.js';

/**
 * A change travels by use, and stops where nothing uses it.
 *
 * The recording is `values-vitest` as committed. Each case writes the tree the
 * diff makes into a copy, scans the copy for the graph, and asks with the
 * recorded texts: the graph a caller holds describes the tree after the change,
 * and `sourceAt` answers for the tree the recording was made from. A package
 * manifest written into the copy is the one the reading asks whether loading a
 * module does something.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/values-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const within = relative(repository, fixture);
const named = (path: string): string => `${within}/${path}`;
const tests = (...names: string[]): string[] => names.map((name) => named(`test/${name}.test.js`));
const limits = named('src/limits.ts');
const slider = named('src/slider.ts');
const wrap = named('src/wrap.ts');
const retries = named('src/retries.ts');
const retrying = named('src/retrying.ts');
const everyLoader = tests('clamp', 'count', 'fill', 'label', 'render', 'slide', 'step', 'unit');

let directory: string;
let coverageFile: string;
/** The fixture as git holds it: the names a copy carries, never what the directory holds right now. */
let committed: string[];
const recorded = new Map<string, string>();

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-usage-'));
  coverageFile = resolve(directory, 'coverage.bin');
  const { stdout } = await execute('git', ['ls-files', '-z', '--', within], { cwd: repository });
  committed = stdout.split('\0').filter(Boolean);
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, XDG_CACHE_HOME: directory },
  });
  for (const file of [limits, slider]) recorded.set(file, readFileSync(resolve(repository, file), 'utf8'));
}, 30_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** The text each file had when the recording was made; a file new since has none. */
const sourceAt = (file: string): string | undefined => {
  const path = resolve(repository, file);
  return recorded.get(file) ?? (existsSync(path) ? readFileSync(path, 'utf8') : undefined);
};

/**
 * The tree a change makes, and its graph: the fixture's committed files copied
 * under the same repository-relative names, with `changes` written over it.
 * `null` removes a file, which is how an edge the scan never saw looks from here.
 *
 * The list is git's, not the directory's: `values.integration.test.ts` runs
 * Vitest in the same fixture, and Vite writes and deletes a
 * `vitest.config.ts.timestamp-*.mjs` beside the config while it loads — a walk of
 * the live directory lists that file and then fails to open it.
 */
async function treeAfter(changes: Record<string, string | null>): Promise<{ root: string; relations: Relations }> {
  const root = await mkdtemp(resolve(directory, 'tree-'));
  for (const file of committed) {
    mkdirSync(dirname(resolve(root, file)), { recursive: true });
    copyFileSync(resolve(repository, file), resolve(root, file));
  }
  for (const [file, text] of Object.entries(changes)) {
    if (text === null) rmSync(resolve(root, file));
    else writeFileSync(resolve(root, file), text);
  }
  return { root, relations: relationsOfFiles(await scanRelations({ root, dirs: [within], digests: false })) };
}

/** The diff git writes from one text to the other, under the file's own name. */
async function diffOf(file: string, before: string | undefined, after: string): Promise<string> {
  const to = resolve(directory, 'after.ts');
  writeFileSync(to, after);
  let from = '/dev/null';
  if (before !== undefined) {
    from = resolve(directory, 'before.ts');
    writeFileSync(from, before);
  }
  const diff = await execute('git', ['diff', '--no-index', '--', from, to]).then(
    () => '',
    (error: { stdout: string }) => error.stdout,
  );
  return diff
    .split('\n')
    .map((line) =>
      line.startsWith('--- ') && before !== undefined
        ? `--- a/${file}`
        : line.startsWith('+++ ')
          ? `+++ b/${file}`
          : line,
    )
    .join('\n');
}

const wrapText = 'export function wrap(value: number): number {\n  return value % 7;\n}\n';
const using = (text: string): string =>
  text
    .replace("import { LIMIT as max } from './limits';", "import { LIMIT as max } from './limits';\nimport { wrap } from './wrap';")
    .replace('return value > max ? max : value;', 'return value > max ? max : wrap(value);');

const retryingText = "import { attempts } from './retries';\n\nexport function retrying(): number {\n  return attempts();\n}\n";
/** `slider.ts` with `slide` calling `name`, imported from `source`. */
const slidingThrough = (text: string, name: string, source: string): string =>
  text
    .replace("import { LIMIT as max } from './limits';", `import { LIMIT as max } from './limits';\nimport { ${name} } from '${source}';`)
    .replace('return value > max ? max : value;', `return value > max ? max : value * ${name}();`);

describe('a change travels by use', () => {
  it('holds the premise: every test the fixture has loaded a file the next cases reach', () => {
    expect(existsSync(resolve(repository, wrap))).toBe(false);
    expect(recorded.get(slider)).toContain('return value > max ? max : value;');
  });

  it('copies the fixture as committed, so a file Vite writes beside its config never enters the tree', async () => {
    const { root } = await treeAfter({});
    const copied = readdirSync(resolve(root, within), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, resolve(entry.parentPath, entry.name)))
      .sort();
    expect(committed).toContain(named('vitest.config.ts'));
    expect(copied).toEqual([...committed].sort());
  });

  it('selects nothing for a new module nothing imports', async () => {
    const tree = await treeAfter({ [wrap]: wrapText });
    const narrowing = await narrowByExecution(coverageFile, await diffOf(wrap, undefined, wrapText), {
      ...tree,
      sourceAt,
    });
    expect(narrowing.readings).toEqual([{ file: wrap, verdict: 'values', names: [] }]);
    expect(narrowing.entered).toEqual([]);
    expect(narrowing.unread).toEqual([]);
  });

  it('charges a new module to the one function that calls it, and to nothing else that loads its importer', async () => {
    const now = using(recorded.get(slider)!);
    const tree = await treeAfter({ [wrap]: wrapText, [slider]: now });
    const diff = (await diffOf(wrap, undefined, wrapText)) + (await diffOf(slider, recorded.get(slider), now));
    const narrowing = await narrowByExecution(coverageFile, diff, { ...tree, sourceAt });
    expect(narrowing.readings).toEqual([
      { file: wrap, verdict: 'values', names: [] },
      { file: slider, verdict: 'bodies', names: [] },
    ]);
    // `label` loads `slider.ts` and never calls `slide`.
    expect(narrowing.entered).toEqual(tests('slide'));
  });

  it('charges a new module that runs something as it loads to every test that loads its importer', async () => {
    // The control for the one above: the same import, of a module that is not
    // only declarations. Loading it is a use.
    const loud = `${wrapText}console.log(wrap(1));\n`;
    const now = using(recorded.get(slider)!);
    const tree = await treeAfter({ [wrap]: loud, [slider]: now });
    const diff = (await diffOf(wrap, undefined, loud)) + (await diffOf(slider, recorded.get(slider), now));
    const narrowing = await narrowByExecution(coverageFile, diff, { ...tree, sourceAt });
    expect(narrowing.readings).toContainEqual({ file: wrap, verdict: 'load', names: [] });
    expect(narrowing.entered).toEqual(tests('label', 'slide'));
  });

  it('charges a new module its package declares to every test that loads its importer', async () => {
    // The same quiet module as the first two cases, which charge `slide`
    // alone. Its package says loading it does something, and the reading
    // takes the package's word over the text's.
    const now = using(recorded.get(slider)!);
    const manifest = JSON.stringify({ sideEffects: ['./src/wrap.ts'] });
    const tree = await treeAfter({ [wrap]: wrapText, [slider]: now, [named('package.json')]: manifest });
    const diff = (await diffOf(wrap, undefined, wrapText)) + (await diffOf(slider, recorded.get(slider), now));
    const narrowing = await narrowByExecution(coverageFile, diff, { ...tree, sourceAt });
    expect(narrowing.readings).toEqual([
      { file: wrap, verdict: 'load', names: [], effects: [wrap] },
      { file: slider, verdict: 'load', names: [], effects: [wrap] },
    ]);
    expect(narrowing.entered).toEqual(tests('label', 'slide'));
  });

  it('reads a pattern that names other files as no declaration of this one', async () => {
    const now = using(recorded.get(slider)!);
    const manifest = JSON.stringify({ sideEffects: ['*.css', './src/limits.ts'] });
    const tree = await treeAfter({ [wrap]: wrapText, [slider]: now, [named('package.json')]: manifest });
    const diff = (await diffOf(wrap, undefined, wrapText)) + (await diffOf(slider, recorded.get(slider), now));
    const narrowing = await narrowByExecution(coverageFile, diff, { ...tree, sourceAt });
    expect(narrowing.entered).toEqual(tests('slide'));
  });

  it('charges an import of a quiet module to every loader when what it loads is declared', async () => {
    // `retrying.ts` is in the tree and no test ever loaded it, so it is not in
    // the diff. It is quiet; `retries.ts` behind it is what the package declares.
    const now = slidingThrough(recorded.get(slider)!, 'retrying', './retrying');
    const manifest = JSON.stringify({ sideEffects: ['./src/retries.ts'] });
    const tree = await treeAfter({ [retrying]: retryingText, [slider]: now, [named('package.json')]: manifest });
    const narrowing = await narrowByExecution(coverageFile, await diffOf(slider, recorded.get(slider), now), {
      ...tree,
      sourceAt,
    });
    expect(narrowing.readings).toEqual([{ file: slider, verdict: 'load', names: [], effects: [retries] }]);
    expect(narrowing.entered).toEqual(tests('label', 'slide'));
  });

  it('charges the same import to its caller alone when nothing it loads is declared', async () => {
    const now = slidingThrough(recorded.get(slider)!, 'retrying', './retrying');
    const tree = await treeAfter({ [retrying]: retryingText, [slider]: now });
    const narrowing = await narrowByExecution(coverageFile, await diffOf(slider, recorded.get(slider), now), {
      ...tree,
      sourceAt,
    });
    expect(narrowing.readings).toEqual([{ file: slider, verdict: 'bodies', names: [] }]);
    expect(narrowing.entered).toEqual(tests('slide'));
  });

  it('charges nothing for a declared module the file already loaded', async () => {
    // `registry.ts` loads `limits.ts`, which `slider.ts` imported before the
    // change: whatever loading it does ran then too.
    const now = slidingThrough(recorded.get(slider)!, 'count', './registry');
    const manifest = JSON.stringify({ sideEffects: ['./src/limits.ts'] });
    const tree = await treeAfter({ [slider]: now, [named('package.json')]: manifest });
    const narrowing = await narrowByExecution(coverageFile, await diffOf(slider, recorded.get(slider), now), {
      ...tree,
      sourceAt,
    });
    expect(narrowing.readings).toEqual([{ file: slider, verdict: 'bodies', names: [] }]);
    expect(narrowing.entered).toEqual(tests('slide'));
  });

  it('charges a removed import of a declared module to every test that loads the importer', async () => {
    const before = recorded.get(slider)!;
    const now = before
      .replace("import { LIMIT as max } from './limits';\n\n", '')
      .replace('return value > max ? max : value;', 'return value > 10 ? 10 : value;');
    const manifest = JSON.stringify({ sideEffects: ['./src/limits.ts'] });
    const tree = await treeAfter({ [slider]: now, [named('package.json')]: manifest });
    const narrowing = await narrowByExecution(coverageFile, await diffOf(slider, before, now), { ...tree, sourceAt });
    expect(narrowing.readings).toEqual([{ file: slider, verdict: 'load', names: [], effects: [limits] }]);
    expect(narrowing.entered).toEqual(tests('label', 'slide'));
  });

  it('charges an edit inside a function of a declared file to every test that loaded it', async () => {
    const tree = await treeAfter({ [named('package.json')]: JSON.stringify({ sideEffects: true }) });
    const before = recorded.get(limits)!;
    const diff = await diffOf(limits, before, before.replace('Math.min(value, LIMIT)', 'Math.max(value, LIMIT)'));
    const narrowing = await narrowByExecution(coverageFile, diff, { ...tree, sourceAt });
    expect(narrowing.readings).toEqual([{ file: limits, verdict: 'load', names: [], effects: [limits] }]);
    expect(narrowing.entered).toEqual(everyLoader);
  });

  it('names the tests it reached through no importer it followed, and charges none of them', async () => {
    // Without `meter.ts` in the graph, `fill` and `unit` loaded `limits.ts` by
    // an edge nobody holds. `fill` reads the value; the selection does not
    // guess that, it says where to look.
    const tree = await treeAfter({ [named('src/meter.ts')]: null });
    const before = recorded.get(limits)!;
    const diff = await diffOf(limits, before, before.replace('LIMIT = 10', 'LIMIT = 20'));
    const narrowing = await narrowByExecution(coverageFile, diff, { ...tree, sourceAt });
    expect(narrowing.readings).toEqual([
      { file: limits, verdict: 'values', names: ['LIMIT'], unseen: tests('fill', 'unit') },
    ]);
    expect(narrowing.entered).toEqual(tests('clamp', 'count', 'render', 'slide'));
  });

  it('follows a value through a module that hands the namespace on whole', async () => {
    const narrowing = await narrowByExecution(
      coverageFile,
      await diffOf(limits, recorded.get(limits), recorded.get(limits)!.replace('STEP = 2', 'STEP = 3')),
      { ...(await treeAfter({})), sourceAt },
    );
    const via = narrowing.because.find((cause) => cause.test === tests('count')[0])?.via;
    expect(via).toContainEqual(
      expect.objectContaining({ kind: 'reader', name: 'STEP', file: limits, reader: named('src/registry.ts') }),
    );
  });
});

it.todo(
  "an edit to a package's `sideEffects` charges every test that loaded a file whose declaration moved — needs a changed manifest read against its recorded text, where selection reads it only as the install it records",
);
