import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Comparison, Place, Side, StoryEntry } from '@variance-authority/sense/story';
import { main, parseArgs } from '../bin.js';
import { formatStory, story } from './story.js';

const PAY = 'src/pay.test.ts';

const entry = (name: string, at: number, file = PAY, label?: string): StoryEntry => ({
  path: `/stories/${name}.${at}.story`, file, name, visits: 2, written: 100 - at, ...(label === undefined ? {} : { label }),
});

/** Three cases of one file, and a case named like one of them in another file. */
const WRITTEN: StoryEntry[] = [
  entry('charges', 0), entry('charges', 1), entry('charges', 2, PAY, 'slow'),
  entry('charges off', 0), entry('charges off', 1, PAY, 'slow'),
  entry('as mike', 0),
  entry('elsewhere', 0, 'src/other.test.ts'),
  entry('as mike', 0, 'src/other.test.ts'),
];

let compared: readonly Side[] | undefined;

// The store and the comparison are cut at the reader: what the run wrote is
// the list above, and a comparison is the sides it was handed.
vi.mock('@variance-authority/sense/story', async (original) => ({
  ...(await original<typeof import('@variance-authority/sense/story')>()),
  listStories: () => WRITTEN,
  compareReadings: (_root: string, sides: readonly Side[]): Comparison => {
    compared = sides;
    return {
      file: sides[0]!.readings[0]!.file, name: sides[0]!.readings[0]!.name,
      sides: sides.map((side) => ({ name: side.name, readings: side.readings.length, stopped: 0 })),
      only: [], orders: [], unsteady: { places: 0, said: 0, order: 0 }, single: true,
    };
  },
}));

const root = await mkdtemp(join(tmpdir(), 'variance-story-cases-'));
const ask = (...argv: string[]) => story(parseArgs(['story', ...argv, '--root', root]) as Parameters<typeof story>[0]);
const sidesOf = () => compared?.map((side) => [side.name, side.readings.map((reading) => reading.path)]);

beforeEach(() => {
  compared = undefined;
});

describe('cases compared with each other', () => {
  it('sets every kept reading of each case named against the others\', one side for each case', () => {
    ask('--file', PAY, '--name', 'charges', '--name', 'charges off', '--name', 'as mike');

    expect(sidesOf()).toEqual([
      ['charges', ['/stories/charges.0.story', '/stories/charges.1.story', '/stories/charges.2.story']],
      ['charges off', ['/stories/charges off.0.story', '/stories/charges off.1.story']],
      ['as mike', ['/stories/as mike.0.story']],
    ]);
  });

  it('takes the cases from any file, naming each side by its file when the files differ', () => {
    ask('--name', 'charges', '--name', 'elsewhere');

    expect(sidesOf()?.map(([name]) => name)).toEqual([`${PAY} > charges`, 'src/other.test.ts > elsewhere']);
  });

  it('keeps only the readings under --label on every side, and refuses a side it leaves empty', () => {
    ask('--name', 'charges', '--name', 'charges off', '--label', 'slow');

    expect(sidesOf()).toEqual([
      ['charges', ['/stories/charges.2.story']],
      ['charges off', ['/stories/charges off.1.story']],
    ]);
    expect(() => ask('--name', 'charges', '--name', `${PAY} > as mike`, '--label', 'slow')).toThrow(
      `no story is written for --name ${PAY} > as mike and --label slow`,
    );
  });

  it('refuses two names for one case', () => {
    expect(() => ask('--name', 'charges', '--name', `${PAY} > charges`)).toThrow(
      `--name charges and --name ${PAY} > charges are one case; name each case once`,
    );
  });

  it('names --file when a name has no story in the file it narrows to', () => {
    expect(() => ask('--file', PAY, '--name', 'charges', '--name', 'elsewhere')).toThrow(
      `no story is written for --name elsewhere and --file ${PAY}`,
    );
  });

  it('refuses a name two files hold, and a name with no story, rather than pick', () => {
    expect(() => ask('--name', 'charges', '--name', 'as mike')).toThrow(
      `--name as mike is a case in ${PAY} and src/other.test.ts; name the file with --file, or compare them as \`<file> > <name>\``,
    );
    expect(() => ask('--name', 'charges', '--name', 'refunds')).toThrow('no story is written for --name refunds');
  });

  it('reads a name written as the case\'s file and name, as a side names it', () => {
    ask('--name', `${PAY} > as mike`, '--name', 'src/other.test.ts > as mike');

    expect(sidesOf()).toEqual([
      [`${PAY} > as mike`, ['/stories/as mike.0.story']],
      ['src/other.test.ts > as mike', ['/stories/as mike.0.story']],
    ]);
  });

  it('prints the cases in its header and each side by its name', () => {
    const answer = ask('--file', PAY, '--name', 'charges', '--name', 'charges off', '--name', 'as mike');

    expect(formatStory(answer, 'text').split('\n').slice(0, 3)).toEqual([
      `compare  ${PAY}`,
      '  `charges` (3 readings), `charges off` (2 readings) and `as mike` (1 reading), against each other',
      '  one reading on a side: what differs below may be a run that went another way, not the side',
    ]);
  });

  it('runs as a command', async () => {
    let out = '';
    const code = await main(['story', '--name', 'charges', '--name', 'charges off', '--root', root], { out: (text) => (out += text), err: () => {} });

    expect(code).toBe(0);
    expect(out.split('\n')[1]).toBe('  `charges` (3 readings) against `charges off` (2 readings)');
  });

  it('is asked for by naming two cases or more, and refuses --compare or a zoom beside them', () => {
    expect(parseArgs(['story', '--name', 'a', '--name', 'b'])).toMatchObject({ compare: { cases: ['a', 'b'] } });
    expect(parseArgs(['story', '--name', 'a'])).toMatchObject({ name: 'a' });
    expect(() => parseArgs(['story', '--name', 'a', '--name', 'a'])).toThrow('--name a is named twice');
    expect(() => parseArgs(['story', '--name', 'a', '--name', 'b', '--compare', 'last'])).toThrow(
      'several --name compare those cases, and --compare compares readings of one; name one case with --compare, or drop it',
    );
    expect(() => parseArgs(['story', '--name', 'a', '--name', 'b', '--whole'])).toThrow('several --name compare cases and read no route, so --whole has nothing to narrow');
  });

  it('still refuses a flag repeated where nothing collects it', () => {
    expect(() => parseArgs(['story', '--file', 'a', '--file', 'b'])).toThrow('`--file` was given more than once');
    expect(() => parseArgs(['ask', 'symbol', '--name', 'a', '--name', 'b'])).toThrow('`--name` was given more than once');
  });
});

describe('labels compared', () => {
  it('takes two labels or more', () => {
    expect(parseArgs(['story', '--compare', '1,slow,fast'])).toMatchObject({ compare: { labels: ['1', 'slow', 'fast'] } });
    expect(() => parseArgs(['story', '--compare', 'slow,slow'])).toThrow('--compare takes last, outcome, or two labels or more as <a>,<b>,…, not `slow,slow`');
  });
});

const PLACE: Place = { file: 'src/pay.ts', name: 'charge', kind: 'function', at: 'src/pay.ts#charge/entry', startLine: 3, endLine: 9 };

describe('three sides printed', () => {
  it('says what separates them under the sides that hold it, and an order by who holds each way', () => {
    const comparison: Comparison = {
      file: PAY, name: 'charges',
      sides: [{ name: 'charges', readings: 2, stopped: 0 }, { name: 'charges off', readings: 2, stopped: 2 }, { name: 'as mike', readings: 2, stopped: 2 }],
      only: [
        { sides: ['charges'], places: [{ place: PLACE, path: 'if#0/then', startLine: 4, endLine: 5, constructLine: 4 }], said: [] },
        { sides: ['charges off', 'as mike'], places: [], said: ['console.log declined'] },
      ],
      orders: [{ pair: [{ said: 'console.log paid' }, { place: PLACE }], before: ['charges', 'charges off'], after: ['as mike'] }],
      unsteady: { places: 0, said: 0, order: 0 },
      single: false,
    };

    expect(formatStory({ comparison, cases: [{ file: PAY, name: 'charges' }, { file: PAY, name: 'charges off' }, { file: PAY, name: 'as mike' }] }, 'text').split('\n').slice(3)).toEqual([
      '  only in `charges`, on every reading:',
      '    went into  charge  src/pay.ts:3-9, the then of the if on 4',
      '',
      '  only in `charges off` and `as mike`, on every reading:',
      '    said       » console.log declined',
      '',
      '  in an order the sides hold differently, on every reading:',
      '    » console.log paid',
      '      before charge  src/pay.ts:3-9 in `charges` and `charges off`, after it in `as mike`',
      '',
    ]);
  });
});
