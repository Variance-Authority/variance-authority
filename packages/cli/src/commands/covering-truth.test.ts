import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { encodeExecutionIndex, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering } from './covering.js';
import { formatCovering } from './covering-text.js';
import { indexOutput } from './index-command.js';

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

const TESTS = ['a.test.ts', 'b.test.ts', 'c.test.ts'];

/** One case per test file, all three of which hold `native/src/lib.rs` as the suite declares it, beside `src/total.ts` some of them ran. */
async function recorded(instrumentation: string, index: object = {
  tests: TESTS.map((file) => ({ id: `${file} > runs`, file, name: 'runs' })),
  modules: [{
    file: 'src/total.ts',
    blocks: [{ kind: 'function', name: 'total', path: 'entry', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 1 }] }],
  }],
}): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'variance-covering-truth-')), 'coverage.bin');
  const held = (name: string) => ({ name, digest: digestString(name) });
  await writeTestCoverage(file, {
    version: 3,
    instrumentation,
    tests: TESTS.map((test) => ({ file: test, complete: true, preconditions: [held(test), held('native/src/lib.rs')] })),
    modules: [],
  }, { index: encodeExecutionIndex(index as Parameters<typeof encodeExecutionIndex>[0]) });
  return file;
}

describe('a source no probe reaches, which the suite declares a precondition of every test file', () => {
  it('is said to be uninstrumented and declared, not listed as a precondition each test file met', async () => {
    const execution = await recorded(INSTRUMENTATION_ID);
    // The text every declaration's digest was taken of.
    const text = join(dirname(execution), 'lib.rs');
    await writeFile(text, 'native/src/lib.rs');

    const answer = await covering(parse(['--file', 'native/src/lib.rs', '--text', text, '--execution', execution]));

    expect([answer.held, answer.preconditionOf, answer.among, answer.frame]).toEqual(['declared', TESTS, 3, undefined]);
    expect(formatCovering(answer, 'text', Date.now())).toBe(
      'native/src/lib.rs is not instrumented: the suite declares it a precondition of every one of the 3 test files ' +
        'these cases come from, so no case is recorded entering any line of it, and a change to it selects all of them.\n' +
        'Where and when the 3 test files named here last ran is not known: the record names no commit.\n',
    );
    expect(formatCovering(answer, 'refs', Date.now())).toBe('native/src/lib.rs declared precondition of: every test file (3); no recorded line\n');
  });
});

describe('a module every test file imports, asked whole', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it('names the cases that called into a range and counts the ones that only loaded it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-covering-hub-'));
    const run = (args: readonly string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    await mkdir(join(root, 'src'));
    run(['init', '--quiet', '--initial-branch', 'main']);
    run(['config', 'user.email', 'fixture@example.test']);
    run(['config', 'user.name', 'Fixture']);
    await writeFile(join(root, 'src/hub.ts'), 'export const hub = () => 1;\n');
    for (const file of TESTS) await writeFile(join(root, file), "import { hub } from './src/hub';\nit('runs', () => hub);\n");
    run(['add', '-A']);
    run(['commit', '--quiet', '-m', 'first']);
    process.chdir(root);
    const execution = join(await mkdtemp(join(tmpdir(), 'variance-covering-truth-')), 'cases.json');
    const block = (startLine: number, endLine: number) =>
      ({ kind: 'function', name: 'hub', path: 'entry', startLine, endLine, source: true, loaded: true, crossings: [{ test: 0, distance: 1 }] });
    const write = (blocks: readonly object[], to = execution) => writeFile(to, JSON.stringify({
      tests: TESTS.map((file) => ({ id: `${file} > runs`, file, name: 'runs' })),
      modules: [{ file: 'src/hub.ts', blocks }],
    }));
    await write([block(1, 9)]);

    await indexOutput({ cwd: root });
    const text = formatCovering(await covering(parse(['--file', 'src/hub.ts', '--root', root, '--execution', execution])), 'text', Date.now());

    expect(text).toBe([
      'src/hub.ts — 1 recorded range, 1 named test in 1 test file, and 2 more that ran it only while their file imported it',
      '  a.test.ts — 1/1',
      '    runs',
      'The record does not say which text of src/hub.ts its lines are numbered in, so they are given as recorded.',
      'Where and when the 3 test files named here last ran is not known: the record names no commit.',
      '',
    ].join('\n'));

    // A test file whose cases called into two ranges is one row, and the range none of them called into is named apart.
    const split = join(execution, '..', 'split.json');
    await write([block(1, 3), { ...block(4, 5), crossings: [] }, block(6, 9)], split);
    const twice = formatCovering(await covering(parse(['--file', 'src/hub.ts', '--root', root, '--execution', split])), 'text', Date.now());

    expect(twice).toContain('src/hub.ts — 3 recorded ranges, 1 named test in 1 test file, and 2 more');
    expect(twice).toContain('\n  a.test.ts — 1/1\n    runs\n');
    expect(twice.split('a.test.ts').length - 1).toBe(1);
    expect(twice).toContain('\nlines 4-5');
  });
});
