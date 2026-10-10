import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { OperatorError } from '../exit.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { digestString } from '@variance-authority/core/format';
import { encodeExecutionIndex, recordOfCases, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { covering, formatCovering } from './covering.js';
import { refold } from './covering-reach.js';
import { indexOutput } from './index-command.js';

const INDEX = {
  tests: [
    { id: 'near', file: 'total.test.ts', name: 'discounts' },
    { id: 'far', file: 'flow.test.tsx', name: 'checks out' },
  ],
  modules: [{
    file: 'src/total.ts',
    blocks: [
      {
        kind: 'function', name: 'applyDiscount', path: 'entry', startLine: 10, endLine: 20,
        source: true, crossings: [{ test: 0, distance: 1 }, { test: 1, distance: 6 }],
      },
      {
        kind: 'function', name: 'round', path: 'entry', startLine: 30, endLine: 34,
        source: true, crossings: [{ test: 1, distance: 3 }],
      },
    ],
  }],
};

async function indexFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-'));
  const file = join(dir, 'cases.json');
  await writeFile(file, JSON.stringify(INDEX));
  return file;
}

async function columnIndexFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-'));
  const file = join(dir, 'cases.bin');
  await writeFile(file, encodeExecutionIndex(INDEX));
  return file;
}

/**
 * {@link INDEX} as a record's cases, beside the record a run leaves when it
 * loaded `src/stabilize.ts` without instrumenting it: a row with no blocks,
 * and a precondition of the one test file that loaded it.
 */
async function recordFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-'));
  const file = join(dir, 'coverage.bin');
  const held = (name: string) => ({ name, digest: digestString(name) });
  await writeTestCoverage(file, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [
      { file: 'total.test.ts', complete: true, preconditions: [held('total.test.ts'), held('src/stabilize.ts')] },
      { file: 'flow.test.tsx', complete: true, preconditions: [held('flow.test.tsx')] },
    ],
    modules: [{ file: 'src/stabilize.ts', sourceDigest: digestString('stabilize'), instrumented: false, blocks: [] }],
  }, { index: encodeExecutionIndex(INDEX) });
  return file;
}

/** {@link INDEX} kept as a record's cases, beside coverage that does not read: a record with no coverage at all. */
async function unreadRecordFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-'));
  const file = join(dir, 'coverage.bin');
  await writeFile(file, recordOfCases({ index: encodeExecutionIndex(INDEX) }));
  return file;
}

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

describe('asking which tests entered a line', () => {
  it('orders a line answer by observed depth', async () => {
    const execution = await indexFile();

    const answer = await covering(parse(['--file', 'src/total.ts', '--line', '12', '--execution', execution]));

    expect(answer.tests?.map((test) => [test.id, test.distance])).toEqual([['near', 1], ['far', 6]]);
    expect(formatCovering(answer, 'text')).toContain('2 named tests covered line 12 of src/total.ts');
  });

  it('answers a function by name and carries the same reading into JSON', async () => {
    const execution = await indexFile();

    const answer = await covering(parse(['--file', 'src/total.ts', '--function', 'round', '--execution', execution]));

    expect(answer.tests?.map((test) => test.id)).toEqual(['far']);
    expect(JSON.parse(formatCovering(answer, 'json')).target).toEqual({ function: 'round' });
  });

  it('answers a bare file as ranges, so an unclaimed region shows up as one', async () => {
    const execution = await indexFile();

    const answer = await covering(parse(['--file', 'src/total.ts', '--execution', execution]));

    expect(answer.ranges?.map((range) => [range.startLine, range.endLine])).toEqual([[10, 20], [30, 34]]);
    expect(formatCovering(answer, 'text')).toContain('2 recorded ranges, 2 named tests');
  });

  it('calls a region no case entered unwalked only when every case finished', () => {
    const answer = { file: 'src/total.ts', from: 'cases.bin', target: { line: 40 }, tests: [] };
    const stopped = [{ id: 'far', file: 'flow.test.tsx', name: 'checks out', stopped: true }];

    expect(formatCovering({ ...answer, stopped: [] }, 'text'))
      .toContain('every case that could have reached it finished: unwalked.');
    expect(formatCovering({ ...answer, stopped }, 'text')).toContain(
      'a hole: a case that could have reached it stopped first, so the record cannot see it.\n' +
        '  stopped: flow.test.tsx > checks out [far]',
    );
    expect(formatCovering(answer, 'text')).toBe('No named test covered line 40 of src/total.ts.\n');
  });

  it('reads a recorded index as columns and a foreign one as JSON', async () => {
    const columns = await covering(parse(['--file', 'src/total.ts', '--line', '12', '--execution', await columnIndexFile()]));
    const json = await covering(parse(['--file', 'src/total.ts', '--line', '12', '--execution', await indexFile()]));

    expect(columns.tests?.map((test) => test.id)).toEqual(['near', 'far']);
    expect(columns.tests).toEqual(json.tests);
  });

  it('refuses a missing index rather than reporting nothing covered', async () => {
    await expect(covering(parse(['--file', 'src/total.ts', '--execution', join(tmpdir(), 'absent.json')])))
      .rejects.toThrow(/no readable per-case execution index/);
  });

  it('points at the recorded spelling when the path is rooted differently', async () => {
    const execution = await indexFile();

    await expect(covering(parse(['--file', '/abs/src/total.ts', '--execution', execution])))
      .rejects.toThrow(/record spells it `src\/total\.ts`/);
  });

  it('names a recorded file that only shares the name as that, not as a spelling of the asked one', async () => {
    const execution = await indexFile();

    const asked = covering(parse(['--file', 'lib/total.ts', '--execution', execution]));

    await expect(asked).rejects.toThrow(/`src\/total\.ts` only shares its name\.$/);
    await expect(asked).rejects.not.toThrow(/record spells it/);
  });

  it('answers a module the run loaded without instrumenting with the test files that loaded it, which a change to it selects', async () => {
    const execution = await recordFile();

    const answer = await covering(parse(['--file', 'src/stabilize.ts', '--execution', execution]));

    expect(answer.preconditionOf).toEqual(['total.test.ts']);
    expect(formatCovering(answer, 'text')).toBe(
      'src/stabilize.ts is a precondition of 1 test file, and a change to it selects every one: the run loaded it ' +
        'without instrumenting it, or the suite declares it, so no line of it has a recorded case.\n  total.test.ts\n',
    );
    expect(formatCovering(answer, 'refs')).toBe('src/stabilize.ts precondition of: total.test.ts; no recorded line\n');
  });

  it('names only the test files of the cases asked about as holding a precondition', async () => {
    const execution = await recordFile();

    const asked = await covering(parse(['--file', 'src/stabilize.ts', '--cases', 'total.test.ts', '--execution', execution]));
    const other = await covering(parse(['--file', 'src/stabilize.ts', '--cases', 'flow.test.tsx', '--execution', execution]));

    expect(asked.preconditionOf).toEqual(['total.test.ts']);
    expect(other.preconditionOf).toEqual([]);
    expect(formatCovering(other, 'text')).toBe(
      'Read from the 1 case of flow.test.tsx, not the whole suite.\n' +
        'No test file of these cases holds src/stabilize.ts as a precondition: the run loaded it without instrumenting ' +
        'it, or the suite declares it, so no line of it has a recorded case.\n',
    );
    expect(formatCovering(other, 'refs')).toContain('src/stabilize.ts precondition of: no test file of these cases; no recorded line\n');
  });

  it('still refuses a file the run never loaded, where the same record holds one it loaded uninstrumented', async () => {
    const execution = await recordFile();

    await expect(covering(parse(['--file', 'src/never.ts', '--execution', execution])))
      .rejects.toThrow(/is not in the index at/);
  });

  it('does not say the run never loaded a file when the record\'s coverage, which keeps that, cannot be read', async () => {
    const execution = await unreadRecordFile();

    const asked = covering(parse(['--file', 'src/stabilize.ts', '--execution', execution]));

    await expect(asked).rejects.toThrow(
      `\`src/stabilize.ts\` is not in the index at \`${execution}\`, and that record's coverage cannot be read, so whether ` +
        'a test file loaded it without instrumenting it is not known.',
    );
    await expect(asked).rejects.not.toHaveProperty('kind', 'unloaded');
  });

  it('still refuses a file as never loaded from an index that carries no coverage to hold preconditions', async () => {
    const asked = covering(parse(['--file', 'src/never.ts', '--execution', await columnIndexFile()]));

    await expect(asked).rejects.toHaveProperty('kind', 'unloaded');
  });

  it('separates a line nothing recorded from a line nothing covered', async () => {
    const execution = await indexFile();

    await expect(covering(parse(['--file', 'src/total.ts', '--line', '2', '--execution', execution])))
      .rejects.toThrow(/outside every recorded region/);
  });

  it('refuses a line and a function together, and a line that is not one', () => {
    expect(() => parse(['--file', 'a.ts', '--line', '3', '--function', 'f'])).toThrow(OperatorError);
    expect(() => parse(['--file', 'a.ts', '--line', '0'])).toThrow(/positive integer/);
    expect(() => parse(['--line', '3'])).toThrow(/needs `--file <path>`/);
  });
});

/**
 * The review reading, over a real checkout.
 *
 * A fixture diff would exercise the join and prove nothing about the part that
 * breaks: `--since` is a ref, and turning a ref into hunks in the coordinates
 * the index spells files in goes through `git` twice and a merge base once.
 * Every failure of that is silent — the wrong coordinate answers about a file
 * nobody changed, and a list of test names is the same shape either way.
 */
describe('asking which cases a change covered', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  const git = (at: string, args: readonly string[]): void => {
    execFileSync('git', args, { cwd: at, stdio: 'pipe' });
  };

  async function checkout(): Promise<{ root: string; execution: string }> {
    const root = await mkdtemp(join(tmpdir(), 'variance-covering-since-'));
    await mkdir(join(root, 'src'), { recursive: true });
    git(root, ['init', '--quiet', '--initial-branch', 'main']);
    git(root, ['config', 'user.email', 'fixture@example.test']);
    git(root, ['config', 'user.name', 'Fixture']);
    const body = Array.from({ length: 40 }, (_, at) => `const line${at + 1} = ${at + 1};`).join('\n');
    await writeFile(join(root, 'src/total.ts'), `${body}\n`);
    await writeFile(join(root, 'total.test.ts'), 'it("discounts", () => {});\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'first']);
    // Outside the checkout: an index written into it is an untracked file, and
    // the diff would then report the answer as part of the change.
    process.chdir(root);
    return { root, execution: await indexFile() };
  }

  const edit = async (root: string, file: string, line: number): Promise<void> => {
    const text = (await readFile(join(root, file), 'utf8')).split('\n');
    text[line - 1] = `${text[line - 1] ?? ''} // edited`;
    await writeFile(join(root, file), text.join('\n'));
  };

  it('names the cases that entered each changed region, and counts what nothing entered', async () => {
    const { root, execution } = await checkout();
    await edit(root, 'src/total.ts', 12);

    await indexOutput({ cwd: root });
    const answer = await covering(parse(['--since', 'main', '--execution', execution]));

    expect(answer.changed?.map((file) => file.file)).toEqual(['src/total.ts']);
    expect(answer.changed?.[0]?.regions.map((region) => [region.name, region.tests.length]))
      .toEqual([['applyDiscount', 2]]);
    expect(formatCovering(answer, 'text')).toContain(
      '1 changed file since main, 1 changed region: 0 nothing covered, 0 covered by one case.',
    );
  });

  it('flags a region one case alone entered, which no line count can say', async () => {
    const { root, execution } = await checkout();
    await edit(root, 'src/total.ts', 31);

    await indexOutput({ cwd: root });
    const answer = await covering(parse(['--since', 'main', '--execution', execution]));

    expect(formatCovering(answer, 'text')).toContain('30-34 function round — 1 case, and it is the only witness');
  });

  it('answers a changed test file with the cases it declares, rather than with no row', async () => {
    const { root, execution } = await checkout();
    await edit(root, 'total.test.ts', 1);

    await indexOutput({ cwd: root });
    const answer = await covering(parse(['--since', 'main', '--execution', execution]));

    expect(answer.changed?.[0]?.cases.map((test) => test.id)).toEqual(['near']);
    expect(formatCovering(answer, 'text')).toContain('a test file — 1 named case declared here');
  });

  it('refuses a ref with no change behind it rather than reporting a clean one', async () => {
    const { execution } = await checkout();

    await expect(covering(parse(['--since', 'main', '--execution', execution])))
      .rejects.toThrow(/nothing has changed since/);
  });

  it('refuses a diff and a place together', () => {
    expect(() => parse(['--since', 'main', '--file', 'src/total.ts'])).toThrow(OperatorError);
    expect(() => parse(['--since', 'main', '--line', '3'])).toThrow(/alternatives/);
  });
});

describe('narrowing the witnesses to what is nearby', () => {
  it('reads a hop range the way a distance loop spells one', () => {
    expect(parse(['--file', 'src/total.ts', '--at-distance', '0-3']).atDistance)
      .toEqual({ from: 0, to: 3 });
    expect(parse(['--file', 'src/total.ts', '--at-distance', '2']).atDistance)
      .toEqual({ from: 2, to: 2 });
    expect(parse(['--file', 'src/total.ts', '--at-distance', '3-']).atDistance?.from).toBe(3);
  });

  it('refuses a hop range it cannot read rather than narrowing to nothing', () => {
    expect(() => parse(['--file', 'src/total.ts', '--at-distance', '0-e']))
      .toThrow(/--at-distance takes hop counts/);
  });

  it('takes `--in-package` without a value', () => {
    expect(parse(['--file', 'src/total.ts', '--in-package']).inPackage).toBe(true);
    expect(parse(['--file', 'src/total.ts']).inPackage).toBeUndefined();
  });

  it('refuses both beside a diff, which is many origins and no one distance', () => {
    for (const flag of [['--at-distance', '0-3'], ['--in-package']]) {
      expect(() => parse(['--since', 'HEAD~1', ...flag])).toThrow(OperatorError);
      expect(() => parse(['--since', 'HEAD~1', ...flag])).toThrow(/do not compose/);
    }
  });

  it('keeps only witnesses whose test file shares the package, and says how many it dropped', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'variance-in-package-'));
    await writeFile(join(dir, 'package.json'), '{"name":"root"}');
    await mkdir(join(dir, 'apps', 'web'), { recursive: true });
    await writeFile(join(dir, 'apps', 'web', 'package.json'), '{"name":"web"}');
    const execution = join(dir, 'cases.json');
    await writeFile(execution, JSON.stringify({
      tests: [
        { id: 'here', file: 'apps/web/total.test.ts', name: 'discounts' },
        { id: 'there', file: 'flow.test.tsx', name: 'checks out' },
      ],
      modules: [{
        file: 'apps/web/src/total.ts',
        blocks: [{
          kind: 'function', name: 'applyDiscount', path: 'entry', startLine: 10, endLine: 20,
          source: true, crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0 }],
        }],
      }],
    }));

    const answer = await covering(parse([
      '--file', 'apps/web/src/total.ts', '--line', '12',
      '--in-package', '--root', dir, '--execution', execution,
    ]));

    expect(answer.tests?.map((test) => test.id)).toEqual(['here']);
    expect(answer.narrowed).toMatchObject({ kept: 1, of: 2 });
    expect(formatCovering(answer, 'text'))
      .toContain('1 of 2 named tests kept.');
  });

  it('joins two neighbouring ranges a narrowing made agree, and counts the cases of the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'variance-in-package-'));
    await writeFile(join(dir, 'package.json'), '{"name":"root"}');
    await mkdir(join(dir, 'apps', 'web'), { recursive: true });
    await writeFile(join(dir, 'apps', 'web', 'package.json'), '{"name":"web"}');
    const execution = join(dir, 'cases.json');
    const block = (name: string, startLine: number, endLine: number, tests: readonly number[]) => ({
      kind: 'function', name, path: 'entry', startLine, endLine, source: true,
      crossings: tests.map((test) => ({ test, distance: 0 })),
    });
    await writeFile(execution, JSON.stringify({
      tests: [
        { id: 'here', file: 'apps/web/total.test.ts', name: 'discounts' },
        { id: 'there', file: 'flow.test.tsx', name: 'checks out' },
      ],
      modules: [{
        file: 'apps/web/src/total.ts',
        blocks: [block('applyDiscount', 10, 20, [0, 1]), block('round', 21, 30, [0]), block('format', 40, 44, [0])],
      }],
    }));

    const answer = await covering(parse(['--file', 'apps/web/src/total.ts', '--in-package', '--root', dir, '--execution', execution]));

    expect(answer.ranges?.map((range) => [range.startLine, range.endLine, range.tests.map((test) => test.id)]))
      .toEqual([[10, 30, ['here']], [40, 44, ['here']]]);
    expect(answer.narrowed).toMatchObject({ kept: 1, of: 2 });
  });

  it('keeps apart two neighbours whose stopped cases differ', () => {
    const range = (startLine: number, endLine: number, stopped?: readonly string[]) => ({
      startLine, endLine, tests: [],
      ...(stopped === undefined ? {} : { stopped: stopped.map((id) => ({ id, file: 'a.test.ts', name: id })) }),
    });

    expect(refold([range(1, 2, ['a']), range(3, 4, ['a']), range(5, 6, ['b']), range(7, 8)]).map((one) => [one.startLine, one.endLine]))
      .toEqual([[1, 4], [5, 6], [7, 8]]);
  });

  it('prints no depth beside a witness', async () => {
    const execution = await indexFile();

    const answer = await covering(parse(['--file', 'src/total.ts', '--line', '12', '--execution', execution]));

    expect(formatCovering(answer, 'text')).not.toContain('depth');
  });
});

/**
 * A region that ran while its module evaluated is credited to no case; the file
 * graph names who loaded it. The graph is read from a real checkout, because
 * what it answers — who imports the module, and whose import is a mock — is
 * decided by `git` and the parser, not by anything a fixture index can hold.
 */
describe('asking who loaded a region that ran while its module evaluated', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  async function checkout(): Promise<{ root: string; execution: string }> {
    const root = await mkdtemp(join(tmpdir(), 'variance-covering-loaded-'));
    const git = (args: readonly string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    };
    await mkdir(join(root, 'src'), { recursive: true });
    git(['init', '--quiet', '--initial-branch', 'main']);
    git(['config', 'user.email', 'fixture@example.test']);
    git(['config', 'user.name', 'Fixture']);
    const body = Array.from({ length: 20 }, (_, at) => `export const line${at + 1} = ${at + 1};`).join('\n');
    await writeFile(join(root, 'src/total.ts'), `${body}\n`);
    await writeFile(join(root, 'src/other.ts'), 'export const other = 1;\n');
    await writeFile(join(root, 'total.test.ts'), "import { line1 } from './src/total';\nit('discounts', () => line1);\n");
    await writeFile(join(root, 'flow.test.ts'), "import { other } from './src/other';\nit('checks out', () => other);\n");
    await writeFile(
      join(root, 'mocked.test.ts'),
      "import { vi } from 'vitest';\nimport { line1 } from './src/total';\nvi.mock('./src/total');\nit('stubs', () => line1);\n",
    );
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'first']);
    process.chdir(root);

    const dir = await mkdtemp(join(tmpdir(), 'variance-covering-'));
    const execution = join(dir, 'cases.json');
    await writeFile(execution, JSON.stringify({
      tests: [
        { id: 'near', file: 'total.test.ts', name: 'discounts' },
        { id: 'far', file: 'flow.test.ts', name: 'checks out' },
        { id: 'stub', file: 'mocked.test.ts', name: 'stubs' },
      ],
      modules: [{
        file: 'src/total.ts',
        blocks: [
          { kind: 'statement', name: 'line3', path: 'statement#2', startLine: 3, endLine: 3, source: true, loaded: true, crossings: [] },
          { kind: 'function', name: 'late', path: 'entry', startLine: 10, endLine: 12, source: true, crossings: [{ test: 1, distance: 0 }] },
        ],
      }],
    }));
    return { root, execution };
  }

  it('names the case whose file imports the module, and not one that mocked it', async () => {
    const { root, execution } = await checkout();

    await indexOutput({ cwd: root });
    const answer = await covering(parse(['--file', 'src/total.ts', '--line', '3', '--root', root, '--execution', execution]));

    expect(answer.tests?.map((test) => [test.id, test.loaded])).toEqual([['near', true]]);
    expect(formatCovering(answer, 'text')).toContain('* ran only while the module evaluated (its file imports it)');
  });

  it('carries the same loaders into a change', async () => {
    const { root, execution } = await checkout();
    const text = (await readFile(join(root, 'src/total.ts'), 'utf8')).split('\n');
    text[2] = `${text[2]} // edited`;
    await writeFile(join(root, 'src/total.ts'), text.join('\n'));

    await indexOutput({ cwd: root });
    const answer = await covering(parse(['--since', 'main', '--root', root, '--execution', execution]));

    expect(answer.changed?.[0]?.regions.map((region) => [region.name, region.tests.length, region.passengers?.map((test) => test.id)]))
      .toEqual([['line3', 0, ['near']]]);
  });
});
