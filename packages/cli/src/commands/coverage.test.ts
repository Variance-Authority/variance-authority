import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, testCoverageFile } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';

type Index = Parameters<typeof encodeExecutionIndex>[0];

const SUITES = {
  suites: { unit: { kind: 'unit' }, stories: { kind: 'visual' }, checkout: { kind: 'e2e' } },
};

const UNIT = { id: 'u', file: 'src/pay.test.ts', name: 'charges once', stopped: false };
const STORY = { id: 's', file: 'src/checkout.stories.tsx', name: 'Primary', stopped: false };

function region(name: string, called: boolean) {
  return {
    kind: 'function', name, path: 'entry', startLine: 1, endLine: 3, source: true,
    crossings: called ? [{ test: 0, distance: 1 }] : [],
  };
}

let cache: string;
let root: string;
let previous: string | undefined;

async function record(at: string, index: Index): Promise<void> {
  await mkdir(dirname(at), { recursive: true });
  await writeFile(at, encodeExecutionIndex(index));
}

// The unit suite ran two of the three regions in `src/pay.ts`; the visual one
// ran one of them and a region of its own; the end-to-end one has not run.
beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-coverage-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  root = await mkdtemp(join(tmpdir(), 'variance-coverage-'));
  execFileSync('git', ['init', '--quiet', root]);
  await writeFile(join(root, 'variance.config.json'), JSON.stringify(SUITES));
  await record(`${testCoverageFile(root, { suite: 'unit' })}.cases.bin`, {
    tests: [UNIT],
    modules: [{ file: 'src/pay.ts', blocks: [region('charge', true), region('refund', true), region('void', false)] }],
  });
  await record(`${testCoverageFile(root, { suite: 'stories' })}.cases.bin`, {
    tests: [STORY],
    modules: [
      { file: 'src/pay.ts', blocks: [region('charge', true), region('refund', false), region('void', false)] },
      { file: 'src/Button.tsx', blocks: [region('Button', true)] },
    ],
  });
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(cache, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

async function ask(argv: readonly string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

describe('coverage of a repository that declares suites', () => {
  it('counts every suite over the regions any suite loaded, with the one that never ran said apart', async () => {
    const answer = await ask(['coverage', '--root', root]);

    expect(answer.code).toBe(0);
    expect(answer.out).toContain('coverage — 4 regions in 2 files the suites loaded');
    expect(answer.out).toMatch(/any suite\s+3\s+75\.0%/u);
    expect(answer.out).toMatch(/checkout\s+e2e\s+unrecorded/u);
    expect(answer.out).toMatch(/stories\s+visual\s+2\s+50\.0%/u);
    expect(answer.out).toMatch(/unit\s+unit\s+2\s+50\.0%/u);
    expect(answer.out).toMatch(/more than one kind\s+1/u);
    expect(answer.out).toMatch(/one kind alone\s+2\s+unit 1 · visual 1/u);
    expect(answer.out).toMatch(/nothing ran\s+1/u);
  });

  it('names why no suite is compared when none is given to the share', async () => {
    const answer = await ask(['coverage', '--root', root]);

    expect(answer.out).toContain('unit: no base: "unit" is not given to the share, so pass `--suite unit --against <record>`');
  });

  it('refuses one base for several suites', async () => {
    const answer = await ask(['coverage', '--root', root, '--against', join(root, 'base.cases.bin')]);

    expect(answer.code).toBe(2);
    expect(answer.err).toContain('`--against` names one base');
  });

  it('prints the count at the base and now, and the parts that add up to the change', async () => {
    const base = join(root, 'base', 'unit.cases.bin');
    await record(base, {
      tests: [UNIT],
      modules: [
        { file: 'src/pay.ts', blocks: [region('charge', true), region('refund', false), region('void', true)] },
        { file: 'src/legacy.ts', blocks: [region('old', true)] },
      ],
    });

    const answer = await ask(['coverage', '--root', root, '--suite', 'unit', '--against', base]);

    expect(answer.code).toBe(0);
    expect(answer.out).toContain("against each suite's base — 3 regions (4 at the base) in 1 file the suites loaded");
    expect(answer.out).toMatch(/unit\s+unit\s+3 -> 2\s+75\.0% -> 66\.7%\s+gained 1 · lost 1 · no longer loads 1 file, 1 had run/u);
    expect(answer.out).toContain('unit: src/pay.test.ts no longer runs 1 region it ran at the base');
    expect(answer.out).toContain(`unit compared with ${base}`);
  });

  it('gives every count and every part to a program', async () => {
    const answer = await ask(['coverage', '--root', root, '--format', 'json']);

    const said = JSON.parse(answer.out) as { count: { regions: number; overlap: unknown }; suites: { suite: string; from?: string }[] };
    expect(said.count.regions).toBe(4);
    expect(said.count.overlap).toEqual({ several: 1, alone: { unit: 1, visual: 1 } });
    expect(said.suites.map((one) => [one.suite, one.from === undefined])).toEqual([
      ['checkout', true],
      ['stories', false],
      ['unit', false],
    ]);
  });

  it('prints a table for a pull request', async () => {
    const answer = await ask(['coverage', '--root', root, '--format', 'markdown']);

    expect(answer.out).toContain('| Suite | Kind | Regions run | Share |');
    expect(answer.out).toContain('| checkout | e2e | unrecorded | |');
    expect(answer.out).toContain('- only unit ran 1 region');
  });

  it.todo('prints each suite\'s count at the last mainline commits, so a trend has somewhere to be read from — needs `variance share` on a mainline to append one row per suite to the history service, and `--history <n>` to read them (spec 0080, item 6)');
  it.todo('writes the markdown answer to the job summary in the GitHub Action whenever the root config declares suites — needs the composite action to run `variance coverage --format markdown` after the suite (spec 0080, item 4)');
});
