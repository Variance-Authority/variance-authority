import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import {
  encodeAsSetExecutionIndex,
  writeTestCoverage,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import { covering, formatCovering } from './covering.js';

const SPEC = 'checkout.test.ts';

/** One thing a case said or the code read, as the frame spells it: name, value, site, level. */
type Item = readonly [name: string, value: string | boolean | number, site: string, level: number];
const spelled = (items: readonly Item[]) => items.map(([name, value, site, level]) => [name, JSON.stringify(value), site, level]);

/** A case that said `said` and whose code read `read`; a case with no `read` was recorded by a runner that did not listen. */
function row(name: string, said: readonly Item[], read?: readonly Item[], misused?: readonly Item[]): ExecutionTest {
  return {
    id: `${SPEC} > ${name}`, file: SPEC, name,
    said: JSON.stringify({
      said: spelled(said),
      ...(read === undefined ? {} : { read: spelled(read) }),
      ...(misused === undefined ? {} : { misused: spelled(misused) }),
    }),
  };
}

const flag = (key: string, value: boolean): Item => [`flags:${key}`, value, 'src/cart.ts:5', 0xffff];

const CASES: readonly ExecutionTest[] = [
  row('ships express', [['network:api', 'mocked', `${SPEC}:4`, 1]], [flag('express', true)]),
  row('ships standard', [['network:api', 'mocked', `${SPEC}:4`, 1]], [flag('express', false)]),
  row('charges the fee', [], [flag('fee', true), flag('express', false)]),
  row('reads nothing', [['flags:express', true, `${SPEC}:9`, 1]], []),
];

async function recorded(tests: readonly ExecutionTest[]): Promise<{ root: string; execution: string }> {
  const root = await mkdtemp(join(tmpdir(), 'variance-covering-read-'));
  const execution = join(root, 'coverage.bin');
  await writeTestCoverage(execution, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, {
    index: encodeAsSetExecutionIndex({
      tests,
      modules: [{
        file: 'src/cart.ts',
        blocks: [{
          kind: 'function', name: 'total', path: 'entry', startLine: 1, endLine: 3,
          source: true, crossings: tests.map((_, test) => ({ test, distance: 0 })),
        }],
      }],
    }),
  });
  return { root, execution };
}

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

function ask(conditions: readonly (readonly ['--read' | '--where', string])[], record: { root: string; execution: string }) {
  return covering(parse([
    '--file', 'src/cart.ts', '--line', '2', '--execution', record.execution, '--root', record.root, ...conditions.flat(),
  ]));
}

const names = (answer: { readonly tests?: readonly ExecutionTest[] }) => answer.tests?.map((test) => test.name).sort();

describe('a case read by what its code read', () => {
  it('keeps exactly the cases whose code read the value, with the grammar of `--where`', async () => {
    const record = await recorded(CASES);

    const answer = await ask([['--read', 'flags:express=false']], record);
    expect(names(answer)).toEqual(['charges the fee', 'ships standard']);
    expect(answer.where).toEqual({ asked: [], read: ['flags:express=false'], kept: 2, of: 4, unmeasured: 0 });
    expect(names(await ask([['--read', 'flags:express']], record))).toEqual(['charges the fee', 'ships express', 'ships standard']);
    expect(names(await ask([['--read', 'flags=true']], record))).toEqual(['charges the fee', 'ships express']);
  });

  it('never keeps a case for what it said when `--read` asked, nor for what its code read when `--where` asked', async () => {
    const record = await recorded(CASES);

    expect(names(await ask([['--read', 'flags:express=true']], record))).toEqual(['ships express']);
    expect(names(await ask([['--where', 'flags:express=true']], record))).toEqual(['reads nothing']);
    expect(names(await ask([['--where', 'network:api=mocked'], ['--read', 'flags:express=false']], record))).toEqual(['ships standard']);
  });

  it('says what it kept by what the code read, beside what the cases recorded', async () => {
    const record = await recorded(CASES);

    expect(formatCovering(await ask([['--read', 'flags:fee']], record), 'text'))
      .toContain('Kept the 1 of 4 cases that covered line 2 of src/cart.ts and read flags:fee.\n');
    expect(formatCovering(await ask([['--where', 'network:api=mocked'], ['--read', 'flags:express=true']], record), 'text'))
      .toContain('Kept the 1 of 4 cases that covered line 2 of src/cart.ts and recorded network:api=mocked and read flags:express=true.\n');
    expect(formatCovering(await ask([['--read', 'flags:tip']], record), 'text'))
      .toContain('Kept none of the 4 cases that covered line 2 of src/cart.ts: none read flags:tip.\n');
  });

  it('counts a case nobody listened to for reads as unmeasured by `--read`, and never by `--where` alone', async () => {
    const record = await recorded([...CASES, row('unheard', [['network:api', 'mocked', `${SPEC}:4`, 1]])]);

    const read = await ask([['--read', 'flags:express']], record);
    expect(read.where).toMatchObject({ kept: 3, of: 5, unmeasured: 1 });
    expect(formatCovering(read, 'text')).toContain('1 case was recorded without reads, so whether it ran under any of that is unmeasured.');
    expect((await ask([['--where', 'network:api']], record)).where).toMatchObject({ kept: 3, of: 5, unmeasured: 0 });
    const none = formatCovering(await ask([['--read', 'flags:tip']], record), 'text');
    expect(none).toContain('Kept none of the 5 cases that covered line 2 of src/cart.ts: none of the 4 with recorded reads read flags:tip.\n');
  });

  it('refuses a condition with no name, naming `--read`', () => {
    expect(() => parse(['--file', 'src/cart.ts', '--read', '=true'])).toThrow(/`--read` takes a dimension/);
  });
});

describe('a misused breadcrumb on a covering case', () => {
  it('prints after the reads and is never kept by `--read`, which no misuse answers', async () => {
    const misused: Item = ['key', 7, 'src/cart.ts:9', 0xffff];
    const record = await recorded([
      row('ships express', [], [flag('express', true)], [misused]),
      row('misuses only', [], [], [misused]),
    ]);

    const text = formatCovering(await ask([], record), 'text');
    expect(text).toContain('ships express — read flags:express=true said nothing, misused varianceBreadcrumb at src/cart.ts:9: the key 7 is not a string');
    expect(text).toContain('misuses only — misused varianceBreadcrumb at src/cart.ts:9: the key 7 is not a string');
    const read = await ask([['--read', 'flags']], record);
    expect(names(read)).toEqual(['ships express']);
    expect(read.where).toMatchObject({ kept: 1, of: 2, unmeasured: 0 });
  });
});
