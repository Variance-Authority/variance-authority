import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import {
  encodeAsSetExecutionIndex,
  rowOf,
  writeTestCoverage,
  type ExecutionIndex,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import { covering, formatCovering } from './covering.js';

const SPEC = 'checkout.test.ts';

function at(line: number): string {
  return `${SPEC}:${line}`;
}

/** One thing a case said, as the frame spells it: name, value, call site, level. */
type Item = readonly [name: string, value: string | number | boolean, site: string, level: number];

function row(name: string, said?: readonly Item[]): ExecutionTest {
  return { id: `${SPEC} > ${name}`, file: SPEC, name, ...(said === undefined ? {} : { said: JSON.stringify({ said: said.map(([name, value, site, level]) => [name, JSON.stringify(value), site, level]) }) }) };
}

const MEASURED: readonly ExecutionTest[] = [
  row('pays mocked', [['network:api', 'mocked', at(4), 1]]),
  row('refunds mocked behind a flag', [
    ['flags:checkout', 'ff-on', at(9), 1],
    ['network:api', 'mocked', at(4), 1],
  ]),
  row('replays a recording', [['network:api', 'recorded', at(14), 1]]),
  row('says nothing', []),
  row('contradicted', [
    ['flags:checkout', 'ff-off', at(20), 1],
    ['flags:checkout', 'ff-on', at(19), 1],
  ]),
  row('half on', [['flags:checkout', 'ff-half', at(24), 1], ['network:api', 'mocked', at(4), 1]]),
];

function indexOf(tests: readonly ExecutionTest[]): ExecutionIndex {
  return {
    tests,
    modules: [{
      file: 'src/cart.ts',
      blocks: [{
        kind: 'function', name: 'total', path: 'entry', startLine: 1, endLine: 3,
        source: true, crossings: tests.map((_, test) => ({ test, distance: 0 })),
      }],
    }],
  };
}

/** A checkout holding a record of these cases, and a config naming the `flag` axis when asked. */
async function recorded(tests: readonly ExecutionTest[], axes = false): Promise<{ root: string; execution: string }> {
  const root = await mkdtemp(join(tmpdir(), 'variance-covering-where-'));
  const execution = join(root, 'coverage.bin');
  await writeTestCoverage(execution, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, {
    index: encodeAsSetExecutionIndex(indexOf(tests)),
  });
  if (axes) {
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({
      names: { axes: [{ axis: 'flags:checkout', values: ['ff-off', 'ff-half', 'ff-on'] }] },
    }));
  }
  return { root, execution };
}

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

function ask(where: readonly string[], record: { root: string; execution: string }, more: readonly string[] = []) {
  return covering(parse([
    '--file', 'src/cart.ts', '--line', '2', '--execution', record.execution, '--root', record.root,
    ...where.flatMap((one) => ['--where', one]), ...more,
  ]));
}

const names = (answer: { readonly tests?: readonly ExecutionTest[] }) => answer.tests?.map((test) => test.name).sort();

describe('a case read by what it said', () => {
  it('keeps exactly the cases that declared the value', async () => {
    const answer = await ask(['network:api=mocked'], await recorded(MEASURED));

    expect(names(answer)).toEqual(['half on', 'pays mocked', 'refunds mocked behind a flag']);
    expect(answer.where).toMatchObject({ kept: 3, of: 6 });
  });

  it('keeps every value of a name asked without one, and holds every repeated `--where`', async () => {
    const record = await recorded(MEASURED);

    expect(names(await ask(['network:api'], record))).toEqual([
      'half on', 'pays mocked', 'refunds mocked behind a flag', 'replays a recording',
    ]);
    expect(names(await ask(['network:api=mocked', 'flags:checkout=ff-on'], record))).toEqual(['refunds mocked behind a flag']);
  });

  it('keeps every key said under a dimension asked alone', async () => {
    const record = await recorded([
      ...MEASURED,
      row('mocks the catalogue', [['network:catalogue', 'mocked', at(30), 1]]),
    ]);

    expect(names(await ask(['network'], record))).toEqual([
      'half on', 'mocks the catalogue', 'pays mocked', 'refunds mocked behind a flag', 'replays a recording',
    ]);
    expect(names(await ask(['network=mocked'], record))).toEqual([
      'half on', 'mocks the catalogue', 'pays mocked', 'refunds mocked behind a flag',
    ]);
    expect(names(await ask(['net'], record))).toEqual([]);
  });

  it('narrows the whole-file answer and the `--cases` answer the same way', async () => {
    const record = await recorded(MEASURED);

    const file = await covering(parse(['--file', 'src/cart.ts', '--execution', record.execution, '--root', record.root, '--where', 'network:api=recorded']));
    expect(file.ranges?.[0]?.tests.map((test) => test.name)).toEqual(['replays a recording']);
    const scoped = await ask(['network:api=recorded'], record, ['--cases', SPEC]);
    expect(names(scoped)).toEqual(['replays a recording']);
  });

  it('reads the preconditions a JSON execution index carries, as the recorded spelling does', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-covering-where-json-'));
    const execution = join(root, 'execution.json');
    // The JSON input spells each item as an object, where the record holds the frame's tuples.
    const spelled = MEASURED.map(({ said, ...test }) => ({
      ...test,
      ...(said === undefined ? {} : {
        preconditions: (JSON.parse(said) as { said: [string, string, string, number][] }).said
          .map(([name, value, site, level]) => ({ name, value: JSON.parse(value) as unknown, site, level })),
      }),
    }));
    await writeFile(execution, JSON.stringify({ ...indexOf(MEASURED), tests: spelled }));

    const answer = await ask(['network:api=mocked'], { root, execution });

    expect(names(answer)).toEqual(['half on', 'pays mocked', 'refunds mocked behind a flag']);
    expect(answer.where).toMatchObject({ kept: 3, of: 6, unmeasured: 0 });
  });

  it('refuses a condition with no name', () => {
    expect(() => parse(['--file', 'src/cart.ts', '--where', '=mocked'])).toThrow(/`--where` takes a dimension/);
  });

  it('answers every case unmeasured, never an empty list, from a record made before cases said anything', async () => {
    const record = await recorded(MEASURED.map(({ said: _, ...test }) => test));

    const answer = await ask(['network:api=mocked'], record);
    const text = formatCovering(answer, 'text');

    expect(answer.tests).toEqual([]);
    expect(answer.where).toMatchObject({ kept: 0, of: 6, unmeasured: 6 });
    expect(text).toContain('Kept none of the 6 cases that covered line 2 of src/cart.ts: none of them was recorded with preconditions.\n');
    expect(text).toContain('6 cases were recorded without preconditions, so whether they ran under any of that is unmeasured.');
    expect(text).not.toMatch(/No named test covered|[Rr]ecord the suite|[Rr]un the suite/);
  });

  it('counts the cases nobody listened to rather than reading them as having said nothing', async () => {
    const answer = await ask(['network:api=mocked'], await recorded([...MEASURED, row('unheard')]));

    expect(answer.where).toMatchObject({ kept: 3, of: 7, unmeasured: 1 });
    expect(formatCovering(answer, 'text')).toMatch(/1 case was recorded without preconditions/);
  });

  it('prints every case with what it said and where, in text and refs, and keeps a contradiction', async () => {
    const answer = await ask([], await recorded(MEASURED));

    const text = formatCovering(answer, 'text');
    expect(text).toContain(`refunds mocked behind a flag — flags:checkout=ff-on (${at(9)}), network:api=mocked (${at(4)})`);
    expect(text).toContain(`contradicted — flags:checkout contradicted: ff-off (${at(20)}), ff-on (${at(19)})`);
    const refs = formatCovering(answer, 'refs');
    expect(refs).toContain(`replays a recording — network:api=recorded (${at(14)})`);
    const json = JSON.parse(formatCovering(answer, 'json')) as { tests: ExecutionTest[] };
    expect(rowOf(json.tests.find((test) => test.name === 'pays mocked')!)).toEqual([
      { name: 'network:api', value: 'mocked', site: at(4), level: 1 },
    ]);
  });
});

describe('a declared axis, which no precondition is read against until spec 0102 says how an axis names a pair', () => {
  it('keeps for `flags:checkout=ff-off` only the case that said it, not the cases that never named the axis', async () => {
    const answer = await ask(['flags:checkout=ff-off'], await recorded(MEASURED, true));

    expect(names(answer)).toEqual(['contradicted']);
  });

  it('keeps a value the axis does not name as any other value, with no vocabulary note', async () => {
    const record = await recorded([...MEASURED, row('flag typo', [['flags:checkout', 'ff-onn', at(30), 1]])], true);

    const answer = await ask(['flags:checkout'], record);
    expect(names(answer)).toEqual(['contradicted', 'flag typo', 'half on', 'refunds mocked behind a flag']);
    expect(answer.where).toEqual({ asked: ['flags:checkout'], kept: 4, of: 7, unmeasured: 0 });
    expect(formatCovering(answer, 'text')).not.toContain('is not one of');
  });

  it('prints no twin, in any form', async () => {
    const record = await recorded([
      row('on', [['flags:checkout', 'ff-on', at(2), 1]]),
      row('off', [['flags:checkout', 'ff-off', at(5), 1]]),
      row('plain', []),
    ], true);

    for (const answer of [await ask([], record), await ask(['flags:checkout=ff-on'], record)]) {
      expect(answer).not.toHaveProperty('twins');
      for (const format of ['text', 'refs'] as const) expect(formatCovering(answer, format)).not.toContain('twin');
    }
  });

  it.todo('reads a case on a declared axis — the base for a name it never said, a value outside the vocabulary, the twin — needs spec 0102 to say how an axis names a `(dimension, key)` pair');
});

describe('`--where` over a function', () => {
  it('says the filter left none of the cases that ran a function, not that nothing ran it', async () => {
    const record = await recorded(MEASURED);

    const answer = await covering(parse([
      '--file', 'src/cart.ts', '--function', 'total', '--execution', record.execution, '--root', record.root, '--where', 'network:api=live',
    ]));

    expect(answer.where).toMatchObject({ kept: 0, of: 6 });
    const text = formatCovering(answer, 'text');
    expect(text).toContain('Kept none of the 6 cases that covered function total of src/cart.ts: none recorded network:api=live.');
    expect(text).not.toContain('No named test covered');
  });
});
