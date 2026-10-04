import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { ConfigError } from '../config-values.js';
import { parseCoveringArgs } from '../covering-args.js';
import { OperatorError } from '../exit.js';
import { flagsFor, synopsisFor } from '../usage.js';
import {
  encodeExecutionIndex,
  writeTestCoverage,
  type ExecutionIndex,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import { covering, formatCovering } from './covering.js';

const SPEC = 'checkout.test.ts';

function at(line: number): string {
  return `${SPEC}:${line}`;
}

function row(name: string, preconditions?: ExecutionTest['preconditions']): ExecutionTest {
  return { id: `${SPEC} > ${name}`, file: SPEC, name, ...(preconditions === undefined ? {} : { preconditions }) };
}

const MEASURED: readonly ExecutionTest[] = [
  row('pays mocked', [{ name: 'network', value: 'mocked', site: at(4), level: 1 }]),
  row('refunds mocked behind a flag', [
    { name: 'flag', value: 'ff-on', site: at(9), level: 1 },
    { name: 'network', value: 'mocked', site: at(4), level: 1 },
  ]),
  row('replays a recording', [{ name: 'network', value: 'recorded', site: at(14), level: 1 }]),
  row('says nothing', []),
  row('contradicted', [
    { name: 'flag', value: 'ff-off', site: at(20), level: 1 },
    { name: 'flag', value: 'ff-on', site: at(19), level: 1 },
  ]),
  row('half on', [{ name: 'flag', value: 'ff-half', site: at(24), level: 1 }, { name: 'network', value: 'mocked', site: at(4), level: 1 }]),
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
    index: encodeExecutionIndex(indexOf(tests)),
  });
  if (axes) {
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({
      names: { axes: [{ axis: 'flag', values: ['ff-off', 'ff-half', 'ff-on'] }] },
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
    const answer = await ask(['network=mocked'], await recorded(MEASURED));

    expect(names(answer)).toEqual(['half on', 'pays mocked', 'refunds mocked behind a flag']);
    expect(answer.where).toMatchObject({ kept: 3, of: 6 });
  });

  it('keeps every value of a name asked without one, and holds every repeated `--where`', async () => {
    const record = await recorded(MEASURED);

    expect(names(await ask(['network'], record))).toEqual([
      'half on', 'pays mocked', 'refunds mocked behind a flag', 'replays a recording',
    ]);
    expect(names(await ask(['network=mocked', 'flag=ff-on'], record))).toEqual(['refunds mocked behind a flag']);
  });

  it('narrows the whole-file answer and the `--cases` answer the same way', async () => {
    const record = await recorded(MEASURED);

    const file = await covering(parse(['--file', 'src/cart.ts', '--execution', record.execution, '--root', record.root, '--where', 'network=recorded']));
    expect(file.ranges?.[0]?.tests.map((test) => test.name)).toEqual(['replays a recording']);
    const scoped = await ask(['network=recorded'], record, ['--cases', SPEC]);
    expect(names(scoped)).toEqual(['replays a recording']);
  });

  it('reads the preconditions a JSON execution index carries, as the recorded spelling does', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-covering-where-json-'));
    const execution = join(root, 'execution.json');
    await writeFile(execution, JSON.stringify(indexOf(MEASURED)));

    const answer = await ask(['network=mocked'], { root, execution });

    expect(names(answer)).toEqual(['half on', 'pays mocked', 'refunds mocked behind a flag']);
    expect(answer.where).toMatchObject({ kept: 3, of: 6, unmeasured: 0 });
  });

  it('refuses a condition with no name', () => {
    expect(() => parse(['--file', 'src/cart.ts', '--where', '=mocked'])).toThrow(/`--where` takes a precondition's name/);
  });

  it('answers unmeasured, never an empty list, from a record made before cases said anything', async () => {
    const record = await recorded(MEASURED.map(({ preconditions: _, ...test }) => test));

    const refused = await ask(['network=mocked'], record).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(OperatorError);
    expect((refused as OperatorError).kind).toBe('unmeasured');
    expect((refused as Error).message).toMatch(/unmeasured/);
  });

  it('counts the cases nobody listened to rather than reading them as having said nothing', async () => {
    const answer = await ask(['network=mocked'], await recorded([...MEASURED, row('unheard')]));

    expect(answer.where).toMatchObject({ kept: 3, of: 7, unmeasured: 1 });
    expect(formatCovering(answer, 'text')).toMatch(/1 case was recorded without preconditions/);
  });

  it('prints every case with what it said and where, in text and refs, and keeps a contradiction', async () => {
    const answer = await ask([], await recorded(MEASURED));

    const text = formatCovering(answer, 'text');
    expect(text).toContain(`refunds mocked behind a flag — flag=ff-on (${at(9)}), network=mocked (${at(4)})`);
    expect(text).toContain(`contradicted — flag contradicted: ff-off (${at(20)}), ff-on (${at(19)})`);
    const refs = formatCovering(answer, 'refs');
    expect(refs).toContain(`replays a recording — network=recorded (${at(14)})`);
    const json = JSON.parse(formatCovering(answer, 'json')) as { tests: ExecutionTest[] };
    expect(json.tests.find((test) => test.name === 'pays mocked')?.preconditions).toEqual([
      { name: 'network', value: 'mocked', site: at(4), level: 1 },
    ]);
  });
});

describe('a case read along a declared axis', () => {
  it('reads a case that never named the axis as standing at its base', async () => {
    const answer = await ask(['flag=ff-off'], await recorded(MEASURED, true));

    expect(names(answer)).toEqual(['contradicted', 'pays mocked', 'replays a recording', 'says nothing']);
  });

  it('reports a value outside the vocabulary by name, and keeps the case', async () => {
    const record = await recorded([...MEASURED, row('flag typo', [{ name: 'flag', value: 'ff-onn', site: at(30), level: 1 }])], true);

    const answer = await ask(['flag=ff-onn'], record);
    expect(names(answer)).toEqual(['flag typo']);
    expect(answer.where?.outside).toEqual([`flag=ff-onn (${at(30)}) is not one of ff-off, ff-half, ff-on`]);
  });

  it('names the twin one step toward the base, from every case the question reached', async () => {
    const answer = await ask(['flag=ff-on'], await recorded(MEASURED, true));

    // A contradiction holds both values, so it is kept; it stands at no one coordinate and has no twin.
    expect(names(answer)).toEqual(['contradicted', 'refunds mocked behind a flag']);
    expect(answer.twins).toEqual([{
      case: `${SPEC} > refunds mocked behind a flag`,
      axis: 'flag',
      from: 'ff-on',
      to: 'ff-half',
      twins: [`${SPEC} > half on`],
    }]);
    expect(formatCovering(answer, 'text')).toContain('twin at flag=ff-half: half on');
  });

  it('walks past an empty step to the base, prints several twins with their count, and says when there is none', async () => {
    const record = await recorded([
      row('on', [{ name: 'flag', value: 'ff-on', site: at(2), level: 1 }]),
      row('plain', []),
      row('also plain', [{ name: 'flag', value: 'ff-off', site: at(5), level: 1 }]),
      row('on and seeded', [{ name: 'flag', value: 'ff-on', site: at(2), level: 1 }, { name: 'seeded', value: true, site: at(7), level: 1 }]),
    ], true);

    const answer = await ask(['flag=ff-on'], record);
    expect(answer.twins).toEqual([
      { case: `${SPEC} > on`, axis: 'flag', from: 'ff-on', to: 'ff-off', twins: [`${SPEC} > also plain`, `${SPEC} > plain`] },
      { case: `${SPEC} > on and seeded`, axis: 'flag', from: 'ff-on', to: 'ff-off', twins: [] },
    ]);
    const text = formatCovering(answer, 'text');
    expect(text).toContain('2 twins at flag=ff-off: also plain, plain');
    expect(text).toContain('no twin recorded');
  });

  it('places no case nobody listened to, matches a stem by every undeclared name, and prints twins in refs', async () => {
    const seededAndMocked = [
      { name: 'seeded', value: true, site: at(7), level: 1 },
      { name: 'network', value: 'mocked', site: at(4), level: 1 },
    ];
    const record = await recorded([
      row('on', [{ name: 'flag', value: 'ff-on', site: at(2), level: 1 }, ...seededAndMocked]),
      row('plain', seededAndMocked),
      row('unheard'),
    ], true);

    const answer = await ask(['flag=ff-on'], record);
    expect(answer.twins).toEqual([
      { case: `${SPEC} > on`, axis: 'flag', from: 'ff-on', to: 'ff-off', twins: [`${SPEC} > plain`] },
    ]);
    expect(formatCovering(answer, 'refs')).toContain('      twin at flag=ff-off: plain');
  });

  it('names the twin of a case a `--function` question reached', async () => {
    const record = await recorded(MEASURED, true);

    const answer = await covering(parse([
      '--file', 'src/cart.ts', '--function', 'total', '--execution', record.execution, '--root', record.root, '--where', 'flag=ff-on',
    ]));
    expect(answer.twins?.map((twin) => [twin.case, twin.twins])).toEqual([
      [`${SPEC} > refunds mocked behind a flag`, [`${SPEC} > half on`]],
    ]);
  });

  it('says the filter left none of the cases that ran a function, not that nothing ran it', async () => {
    const record = await recorded(MEASURED);

    const answer = await covering(parse([
      '--file', 'src/cart.ts', '--function', 'total', '--execution', record.execution, '--root', record.root, '--where', 'network=live',
    ]));

    expect(answer.where).toMatchObject({ kept: 0, of: 6 });
    const text = formatCovering(answer, 'text');
    expect(text).toContain('Kept none of the 6 cases that covered function total of src/cart.ts: none recorded network=live.');
    expect(text).not.toContain('No named test covered');
  });

  it('prints a value outside the vocabulary under what it kept', async () => {
    const record = await recorded([row('flag typo', [{ name: 'flag', value: 'ff-onn', site: at(30), level: 1 }])], true);

    expect(formatCovering(await ask(['flag'], record), 'text'))
      .toContain(`  flag=ff-onn (${at(30)}) is not one of ff-off, ff-half, ff-on`);
  });

  it('refuses a config that is not JSON, naming the file, rather than reading no axes', async () => {
    const record = await recorded(MEASURED);
    await writeFile(join(record.root, 'variance.config.json'), '{ "names": ');

    const refused = await ask(['flag=ff-on'], record).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ConfigError);
    expect((refused as Error).message).toMatch(/variance\.config\.json.*is not valid JSON/);
  });
});
