import { describe, expect, it } from 'vitest';
import type { ExecutionBlock, ExecutionIndex } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { faultSelection } from './select-fault.js';
import { candidatesOf, checkedAnswer, formatCheckedAnswer, hangLimit, verdictOf } from './covering-checked.js';

/**
 * A region the cases entered is checked when a run without it goes red or
 * never finishes, and unchecked when the run stays green.
 */
describe('which regions the cases that entered them check', () => {
  const block = (name: string, crossings: ExecutionBlock['crossings'], source = true): ExecutionBlock => ({
    kind: 'function', name, path: 'entry', startLine: 1, endLine: 3, source, crossings,
  });
  const index: ExecutionIndex = {
    tests: [
      { id: 'a > one', file: 'test/a.test.ts', name: 'one', stopped: false },
      { id: 'a > two', file: 'test/a.test.ts', name: 'two', stopped: false },
      { id: 'b > one', file: 'test/b.test.ts', name: 'one', stopped: false },
    ],
    modules: [{
      file: 'src/w.ts',
      blocks: [
        block('', [{ test: 0, distance: 0 }]),
        block('both', [{ test: 0, distance: 0 }, { test: 1, distance: 0 }, { test: 2, distance: 0 }]),
        block('none', []),
        block('elsewhere', [{ test: 2, distance: 0 }], false),
      ],
    }],
  };

  it('skips the regions a case entered, counting the test files, and counts the rest as never entered', () => {
    const { candidates, unentered } = candidatesOf(index, 'src/w.ts', (ordinal) => ordinal !== 0);

    expect(candidates.map(({ ordinal, witnesses }) => ({ ordinal, witnesses }))).toEqual([{ ordinal: 1, witnesses: 2 }]);
    expect(unentered).toBe(1);
  });

  it('reads a region from the row that holds its source, as the faulted run selects it', () => {
    const built = { file: 'src/w.ts', blocks: [block('both', [{ test: 2, distance: 0 }], false), block('none', [], false)] };
    const twice: ExecutionIndex = { ...index, modules: [built, ...index.modules] };
    const { candidates } = candidatesOf(twice, 'src/w.ts', (ordinal) => ordinal !== 0);
    const selected = faultSelection(['test/a.test.ts', 'test/b.test.ts'], twice, { file: 'src/w.ts', ordinal: 1 });

    expect(candidates.map(({ ordinal, witnesses }) => ({ ordinal, witnesses }))).toEqual([{ ordinal: 1, witnesses: 2 }]);
    expect(selected.notes).toEqual(['2 test files entered src/w.ts#1, lines 1-3']);
  });

  it('refuses a file no case loaded', () => {
    expect(() => candidatesOf(index, 'src/x.ts', () => true)).toThrow('the run recorded no region of src/x.ts');
  });

  it('reads a red run and a stopped one as noticed, and only a green one as passed', () => {
    expect(verdictOf({ exit: 1, hung: false, ms: 5 }, true)).toBe('noticed');
    expect(verdictOf({ exit: null, hung: true, ms: 5 }, true)).toBe('hung');
    expect(verdictOf({ exit: 0, hung: false, ms: 5 }, true)).toBe('passed');
  });

  it('reads no verdict from a run that never read the file with the region left out', () => {
    expect(() => verdictOf({ exit: 1, hung: false, ms: 5 }, false)).toThrow('never read the file with the region left out');
    expect(() => verdictOf({ exit: 0, hung: false, ms: 5 }, false)).toThrow('never read the file with the region left out');
    expect(() => verdictOf({ exit: null, hung: true, ms: 5 }, false)).toThrow('never read the file with the region left out');
  });

  it('waits three plain runs, and never under ten seconds', () => {
    expect(hangLimit(1_000)).toBe(10_000);
    expect(hangLimit(20_000)).toBe(60_000);
  });

  it('says how many regions pass whatever they do', () => {
    const region = { name: 'pick', path: 'if#0/then', startLine: 3, endLine: 3, witnesses: 1 };
    const text = formatCheckedAnswer({
      file: 'src/pick.js',
      regions: [{ ...region, ordinal: 2, verdict: 'noticed' }, { ...region, ordinal: 4, startLine: 7, endLine: 9, witnesses: 2, verdict: 'passed' }],
      unentered: 1,
    }, 'text');

    expect(text).toBe([
      'src/pick.js: 2 regions the cases entered; 1 passes whatever it does',
      '  line 3  pick if#0/then: 1 test file entered it, and went red without it',
      '  lines 7-9  pick if#0/then: 2 test files entered it, and passed without it',
      '1 region no case entered',
      '',
    ].join('\n'));
  });
});

describe('a checked question whose plain run cannot be read against', () => {
  const asked = { command: 'covering', root: process.cwd(), format: 'text', suite: 'unit', file: 'package.json', checked: ['yarn', 'vitest', 'run'] } as const;

  it('is refused when the command fails as written, and nothing else runs', async () => {
    const runs: unknown[] = [];
    await expect(checkedAnswer(asked, async (env) => {
      runs.push(env);
      return { exit: 1, hung: false, ms: 5 };
    })).rejects.toThrow('did not pass as written (exit 1)');
    expect(runs).toHaveLength(1);
  });

  it('is refused when the command passes and records nothing', async () => {
    await expect(checkedAnswer(asked, async () => ({ exit: 0, hung: false, ms: 5 }))).rejects.toThrow('recorded nothing at');
  });
});

describe('the command a checked question runs', () => {
  const COVERING = ['--file', '--line', '--function', '--checked', '--suite', '--root', '--format', '--since'];
  const parsed = (argv: readonly string[]) => parseCoveringArgs(readFlags(argv, 'covering', COVERING, 'variance covering'));

  it('is everything after `--`', () => {
    expect(parsed(['--file', 'package.json', '--checked', '--', 'yarn', 'vitest', 'run'])).toMatchObject({
      file: 'package.json',
      checked: ['yarn', 'vitest', 'run'],
    });
  });

  it('is required beside `--checked`, and refused without it', () => {
    expect(() => parsed(['--file', 'package.json', '--checked'])).toThrow('`--checked` runs the command after `--`');
    expect(() => parsed(['--file', 'package.json', '--', 'yarn'])).toThrow();
  });

  it('asks about a whole file: a line or a function beside it is refused', () => {
    expect(() => parsed(['--file', 'package.json', '--line', '3', '--checked', '--', 'yarn'])).toThrow('`--checked` reads every region of the file');
  });
});
