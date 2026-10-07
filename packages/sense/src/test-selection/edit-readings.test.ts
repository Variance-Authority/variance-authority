import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativeAvailable } from '../addon.js';
import { digestString } from '../digest.js';
import { INSTRUMENTATION_ID } from '../instrument/index.js';
import { editKey, editReadings, type EditReading } from './edit-readings.js';
import { encodeTestCoverage } from './format.js';
import { mergeCoverage } from './merge.js';
import type { TestCoverage } from './index.js';

const FILE = 'src/decide.ts';
const BEFORE = [
  'export const LIMIT = 1;',
  '',
  'export function decide(n: number): boolean {',
  '  return n > 0;',
  '}',
  '',
].join('\n');

/**
 * `alpha` entered `decide`, `delta` loaded the module and entered nothing in it,
 * and `beta` is the run laid over them, recorded over `after`.
 */
function recorded(commit: string, source: string, tests: readonly string[], edited: boolean): TestCoverage {
  const moved = (digest: string): string => (edited ? `${digest}-edited` : digest);
  const holding = (files: readonly string[]): string[] => files.filter((file) => tests.includes(file));
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: tests.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [{
      file: FILE,
      sourceDigest: digestString(source),
      instrumented: true,
      blocks: [
        { ordinal: 0, kind: 'module', digest: moved('block:module'), name: '', path: 'module', startLine: 1, endLine: 5, source: true, testFiles: holding(['test/alpha.test.ts', 'test/beta.test.ts', 'test/delta.test.ts']) },
        { ordinal: 1, kind: 'function', owner: 0, digest: moved('block:decide'), name: 'decide', path: 'entry', startLine: 3, endLine: 5, source: true, testFiles: holding(['test/alpha.test.ts']) },
      ],
    }],
  };
}

const AFTER = BEFORE.replace('n > 0', 'n >= 0');
const PREVIOUS = recorded('1111111111111111111111111111111111111111', BEFORE, ['test/alpha.test.ts', 'test/delta.test.ts'], false);
const CURRENT = recorded('1111111111111111111111111111111111111111', AFTER, ['test/beta.test.ts'], true);

function demotedBy(reading: EditReading | undefined): string[] {
  const readings = new Map<string, EditReading>();
  if (reading !== undefined) readings.set(editKey(FILE, digestString(BEFORE), digestString(AFTER)), reading);
  return mergeCoverage(PREVIOUS, CURRENT, new Map(), readings)
    .tests.filter((test) => !test.complete).map((test) => test.file);
}

describe('demoting a carried test by how far the edit under a run reached it', () => {
  it('demotes every test on an edited region when the edit has no reading', () => {
    expect(demotedBy(undefined)).toEqual(['test/alpha.test.ts', 'test/delta.test.ts']);
  });

  it('demotes every loader when the edit moved what the module does as it loads', () => {
    expect(demotedBy('load')).toEqual(['test/alpha.test.ts', 'test/delta.test.ts']);
  });

  it('demotes the tests that entered an edited body, and not those that only loaded the module', () => {
    expect(demotedBy('bodies')).toEqual(['test/alpha.test.ts']);
  });

  it('demotes nobody over an edit that runs nothing differently', () => {
    expect(demotedBy('none')).toEqual([]);
  });
});

describe.runIf(nativeAvailable())('reading the edit under a run', () => {
  /** A checkout holding `BEFORE` and `files` at its commit, and `after` on disk. */
  function checkout(after: string, files: Readonly<Record<string, string>> = {}): { root: string; commit: string } {
    const root = mkdtempSync(join(tmpdir(), 'va-edit-readings-'));
    const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git(['init', '--quiet', '--initial-branch', 'main']);
    git(['config', 'user.email', 'fixture@example.test']);
    git(['config', 'user.name', 'Fixture']);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, FILE), BEFORE);
    for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'recorded']);
    writeFileSync(join(root, FILE), after);
    return { root, commit: git(['rev-parse', 'HEAD']) };
  }

  async function readingOf(
    after: string,
    commit?: string,
    files?: Readonly<Record<string, string>>,
    onDisk: (root: string) => void = () => {},
  ): Promise<EditReading | undefined> {
    const { root, commit: head } = checkout(after, files);
    onDisk(root);
    const previous = encodeTestCoverage(recorded(commit ?? head, BEFORE, ['test/alpha.test.ts'], false));
    const readings = await editReadings(root, previous, recorded(head, after, ['test/beta.test.ts'], true), new Map(), join(root, '.cache'));
    return readings.get(editKey(FILE, digestString(BEFORE), digestString(after)));
  }

  it('reads an edit inside a function as a body edit', async () => {
    expect(await readingOf(AFTER)).toBe('bodies');
  });

  it('reads a moved value as a load, since its readers are not read here', async () => {
    expect(await readingOf(BEFORE.replace('LIMIT = 1', 'LIMIT = 2'))).toBe('load');
  });

  it('reads an edit that changed a type alone as one that runs nothing differently', async () => {
    expect(await readingOf(BEFORE.replace('n: number', 'n: 0 | 1'))).toBe('none');
  });

  it('reads the edit to a module the run did not load, from the text the landing cuts it again in', async () => {
    const { root, commit } = checkout(AFTER);
    const previous = encodeTestCoverage(recorded(commit, BEFORE, ['test/alpha.test.ts'], false));
    const run = { ...recorded(commit, AFTER, ['test/beta.test.ts'], true), modules: [] };

    const readings = await editReadings(root, previous, run, new Map([[FILE, AFTER]]), join(root, '.cache'));

    expect(readings.get(editKey(FILE, digestString(BEFORE), digestString(AFTER)))).toBe('bodies');
  });

  it('has no reading when the text the rows were cut from is nowhere to be had', async () => {
    expect(await readingOf(AFTER, '2222222222222222222222222222222222222222')).toBeUndefined();
  });

  it('reads a body edit that binds a new import as a load, since a landing holds no graph', async () => {
    const after = `import { floor } from './floor.js';\n${BEFORE.replace('n > 0', 'n > floor')}`;

    expect(await readingOf(after, undefined, { 'src/floor.ts': 'export const floor = 0;\n' })).toBe('load');
  });

  it('reads a body edit as a load in a module its package declares an effect of', async () => {
    const effects = { 'package.json': JSON.stringify({ name: 'decide', sideEffects: ['./src/decide.ts'] }) };

    expect(await readingOf(AFTER, undefined, effects)).toBe('load');
  });

  it('has no reading when the text the run saw is gone from disk and was not kept', async () => {
    expect(await readingOf(AFTER, undefined, {}, (root) => rmSync(join(root, FILE)))).toBeUndefined();
  });

  it('has no reading when the text the run saw does not parse', async () => {
    expect(await readingOf(`${AFTER}export function (\n`)).toBeUndefined();
  });
});
