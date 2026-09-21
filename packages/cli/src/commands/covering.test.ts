import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { OperatorError } from '../exit.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { encodeExecutionIndex } from '@variance-authority/sense/test-selection';
import { covering, formatCovering } from './covering.js';

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

    const answer = await covering(parse(['--since', 'main', '--execution', execution]));

    expect(formatCovering(answer, 'text')).toContain('30-34 function round — 1 case, and it is the only witness');
  });

  it('answers a changed test file with the cases it declares, rather than with no row', async () => {
    const { root, execution } = await checkout();
    await edit(root, 'total.test.ts', 1);

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
      .toContain('1 of 2 named tests that covered it are inside the narrowing');
  });

  it('prints no depth beside a witness', async () => {
    const execution = await indexFile();

    const answer = await covering(parse(['--file', 'src/total.ts', '--line', '12', '--execution', execution]));

    expect(formatCovering(answer, 'text')).not.toContain('depth');
  });
});
