import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { OperatorError } from '../exit.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering } from './covering.js';
import { formatCovering } from './covering-text.js';

/** Twelve test files, the first with twelve cases and each next with one fewer, every case calling into one function. */
const FILES = Array.from({ length: 12 }, (_, at) => `t${String(at).padStart(2, '0')}.test.ts`);
const TESTS = FILES.flatMap((file, at) =>
  Array.from({ length: 12 - at }, (_, n) => ({ id: `${file} > case ${n}`, file, name: `case ${n}` })));
const INDEX = {
  tests: TESTS,
  modules: [{
    file: 'src/hub.ts',
    blocks: [
      { kind: 'function', name: 'hub', path: 'entry', startLine: 1, endLine: 5, source: true, crossings: TESTS.map((_, test) => ({ test, distance: 1 })) },
      { kind: 'function', name: 'spoke', path: 'entry', startLine: 6, endLine: 9, source: true, crossings: [{ test: 0, distance: 1 }] },
    ],
  }],
};

async function indexFile(): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'variance-covering-bounded-')), 'cases.json');
  await writeFile(file, JSON.stringify(INDEX));
  return file;
}

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

async function ask(argv: readonly string[]): Promise<string> {
  const question = parse([...argv, '--execution', await indexFile()]);
  return formatCovering(await covering(question), question.format, Date.now(), question.page);
}

describe('a covering answer an agent reads', () => {
  it('names each test file of a whole file once, the most cases first, and pages past ten', async () => {
    const text = await ask(['--file', 'src/hub.ts']);

    expect(text).toContain('src/hub.ts — 2 recorded ranges, 78 named tests in 12 test files\n  t00.test.ts — 12 cases\n');
    expect(text.split('t00.test.ts').length - 1).toBe(1);
    expect(text).toContain('  t09.test.ts — 3 cases\n');
    expect(text).not.toContain('t10.test.ts');
    expect(text).toContain('2 more not shown; `--offset` 10 shows the next 2.');
    expect(text).not.toContain('lines 1-5');
  });

  it('shows three case names under a file and counts the rest', async () => {
    const text = await ask(['--file', 'src/hub.ts', '--line', '2']);

    expect(text).toContain('  t00.test.ts — 12/12\n    case 0\n    case 1\n    case 10\n    and 9 more\n');
    expect(text).toContain('`--format json` names every case.');
  });

  it('shows the page `--offset` and `--limit` ask for', async () => {
    const text = await ask(['--file', 'src/hub.ts', '--line', '2', '--offset', '10', '--limit', '5']);

    expect(text).toContain('Rows 11–12 of 12.');
    expect(text).toContain('  t10.test.ts — 2/2\n');
    expect(text).toContain('  t11.test.ts — 1/1\n');
    expect(text).not.toContain('t09.test.ts');
    expect(text).not.toContain('more not shown');
  });

  it('keeps every case in JSON', async () => {
    const json = JSON.parse(await ask(['--file', 'src/hub.ts', '--line', '2', '--format', 'json'])) as { tests: unknown[] };

    expect(json.tests).toHaveLength(78);
  });

  it('refuses a page that is not a whole number', () => {
    expect(() => parse(['--file', 'src/hub.ts', '--offset', 'x'])).toThrow(OperatorError);
    expect(() => parse(['--file', 'src/hub.ts', '--limit', '0'])).toThrow(/--limit/);
  });
});
