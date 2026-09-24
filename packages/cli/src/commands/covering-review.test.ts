import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { formatCovering, type Covering, type StatedRegion } from './covering.js';

const test = (id: string) => ({ id, file: 'total.test.ts', name: id, distance: 0 });
const stopped = { id: 'late', file: 'flow.test.ts', name: 'checks out', stopped: true };
const region = (name: string, startLine: number, rest: Partial<StatedRegion>): StatedRegion => ({
  kind: 'function', name, startLine, endLine: startLine + 2, tests: [], ...rest,
});

const ANSWER: Covering = {
  since: 'main',
  directory: 'packages/cart',
  from: 'cases.bin',
  changed: [{
    file: 'src/total.ts',
    recorded: true,
    cases: [],
    regions: [
      region('applyDiscount', 10, { tests: [test('a'), test('b')], state: 'walked' }),
      region('round', 20, { tests: [test('a')], stopped: [], state: 'alone' }),
      region('refund', 30, { stopped: [], state: 'unwalked' }),
      region('settle', 40, { stopped: [stopped], state: 'hole' }),
    ],
  }],
};

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

describe('a review of a diff, in the shape a code host draws', () => {
  it('prints GitHub workflow commands, holes first as warnings, and leaves walked code alone', () => {
    expect(formatCovering(ANSWER, 'github').split('\n')).toEqual([
      '::warning file=packages/cart/src/total.ts,line=40,endLine=42,title=Hole%3A settle::' +
        'No case entered function settle, and a case that could have reached it stopped first: checks out.',
      '::notice file=packages/cart/src/total.ts,line=30,endLine=32,title=Unwalked%3A refund::' +
        'No case entered function refund, and every case that could have reached it finished.',
      '::notice file=packages/cart/src/total.ts,line=20,endLine=22,title=One case%3A round::' +
        'One case entered function round: a (total.test.ts).',
      '',
    ]);
  });

  it('prints one Bitbucket annotations body in the same order, paths from the repository top', () => {
    const batches = formatCovering(ANSWER, 'bitbucket-annotations').trimEnd().split('\n');
    expect(batches).toHaveLength(1);
    const annotations = JSON.parse(batches[0]!);

    expect(annotations.map((entry: { path: string; line: number; severity: string }) =>
      [entry.path, entry.line, entry.severity])).toEqual([
      ['packages/cart/src/total.ts', 40, 'MEDIUM'],
      ['packages/cart/src/total.ts', 30, 'LOW'],
      ['packages/cart/src/total.ts', 20, 'LOW'],
    ]);
    expect(new Set(annotations.map((entry: { external_id: string }) => entry.external_id)).size).toBe(3);
  });

  it('prints one Bitbucket report body counting what the annotations draw', () => {
    const report = JSON.parse(formatCovering(ANSWER, 'bitbucket-report'));

    expect(report.report_type).toBe('COVERAGE');
    expect(report.details).toBe('4 changed regions since main. 3 annotated.');
    expect(Object.fromEntries(report.data.map((entry: { title: string; value: number }) => [entry.title, entry.value])))
      .toEqual({
        'Changed regions': 4,
        Holes: 1,
        'Nothing entered': 2,
        'One case': 1,
        'Changed files the record does not hold': 0,
      });
  });

  it('posts a large change in batches Bitbucket takes, and says what it could not keep', () => {
    const many: Covering = {
      ...ANSWER,
      at: '03984ae78218aa',
      changed: [{
        file: 'src/big.ts',
        recorded: true,
        cases: [],
        regions: Array.from({ length: 1234 }, (_, index) => region(`r${index}`, index * 3 + 1, { stopped: [], state: 'unwalked' })),
      }],
    };

    const batches = formatCovering(many, 'bitbucket-annotations').trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(batches.map((batch: unknown[]) => batch.length)).toEqual(Array.from({ length: 10 }, () => 100));
    const report = JSON.parse(formatCovering(many, 'bitbucket-report'));
    expect(report.details).toBe(
      '1234 changed regions since main. 1000 of 1234 annotated, holes first; Bitbucket keeps no more on one report.',
    );
    expect(report.data.at(-1)).toEqual({ title: 'Recorded at', type: 'TEXT', value: '03984ae78218' });
  });

  it('escapes what a workflow command is made of', () => {
    const odd: Covering = {
      ...ANSWER,
      directory: '',
      changed: [{ file: 'a,b:c.ts', recorded: true, cases: [], regions: [region('x', 1, { stopped: [], state: 'unwalked' })] }],
    };

    expect(formatCovering(odd, 'github')).toContain('file=a%2Cb%3Ac.ts,');
  });

  it('answers a diff and nothing narrower', () => {
    expect(() => parse(['--file', 'src/total.ts', '--format', 'github'])).toThrow(/answers `--since <ref>`/);
    expect(() => parse(['--since', 'main', '--text', '-'])).toThrow(/are alternatives/);
    expect(parse(['--since', 'main', '--format', 'bitbucket-report']).format).toBe('bitbucket-report');
  });
});
