import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';

type Index = Parameters<typeof encodeExecutionIndex>[0];

const MAIN = { id: 'm', file: 'apps/main/src/main.test.ts', name: 'boots', stopped: false };
const LABEL = { id: 'l', file: 'libs/ui/src/label.test.ts', name: 'labels', stopped: false };
const SPECS = { id: 's', file: 'libs/specs/icon.test.ts', name: 'draws', stopped: false };

const files: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*', 'libs/*'] }),
  'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit' } } }),
  'apps/main/package.json': JSON.stringify({ name: 'main' }),
  'apps/main/src/main.ts': "import { button } from '../../../libs/ui/src/button/button';\nbutton();\n",
  'apps/main/src/main.test.ts': "import './main';\n",
  'libs/ui/package.json': JSON.stringify({ name: 'ui' }),
  'libs/ui/src/button/button.ts': "import { icon } from './icon';\nexport function button() {\n  return icon();\n}\nexport function press() {\n  return 2;\n}\n",
  'libs/ui/src/button/icon.ts': 'export function icon() {\n  return 1;\n}\n',
  'libs/ui/src/label.ts': 'export function label() {\n  return 1;\n}\n',
  'libs/ui/src/label.test.ts': "import { label } from './label';\nlabel();\n",
  'libs/specs/package.json': JSON.stringify({ name: 'specs' }),
  'libs/specs/icon.test.ts': "import { icon } from '../ui/src/button/icon';\nicon();\n",
};

/** A region the cases at `tests` called into. */
function region(name: string, tests: readonly number[]) {
  return {
    kind: 'function', name, path: 'entry', startLine: 1, endLine: 3, source: true,
    crossings: tests.map((test) => ({ test, distance: 1 })),
  };
}

let cache: string;
let previous: string | undefined;
let repo: string;

async function record(at: string, index: Index): Promise<void> {
  await mkdir(dirname(at), { recursive: true });
  const cases = { index: encodeExecutionIndex(index) };
  const held = await readFile(at).catch(() => undefined);
  if (held === undefined) await writeTestCoverage(at, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, cases);
  else await writeFile(at, withCaseSections(held, cases));
}

async function ask(argv: readonly string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

// `apps/main`'s test runs the button and its icon; `libs/ui`'s own test runs
// only the label, and `libs/specs`, a package of nothing but tests, runs the
// icon too. So three of the four `libs/ui` regions that ran are run only
// by a test in another package.
beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-coverage-owner-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  repo = await mkdtemp(join(tmpdir(), 'variance-coverage-owner-'));
  execFileSync('git', ['init', '--quiet', repo]);
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(repo, file)), { recursive: true });
    await writeFile(join(repo, file), text);
  }
  execFileSync('git', ['add', '.'], { cwd: repo });
  const cwd = process.cwd();
  process.chdir(repo);
  try {
    const indexed = await ask(['index']);
    if (indexed.code !== 0) throw new Error(`variance index failed in ${repo}: ${indexed.err}`);
  } finally {
    process.chdir(cwd);
  }
  await record(testCoverageFile(repo, { suite: 'unit' }), {
    tests: [MAIN, LABEL, SPECS],
    modules: [
      { file: 'apps/main/src/main.test.ts', blocks: [region('module', [0])] },
      { file: 'apps/main/src/main.ts', blocks: [region('module', [0])] },
      { file: 'libs/ui/src/button/button.ts', blocks: [region('button', [0]), region('press', [0])] },
      { file: 'libs/ui/src/button/icon.ts', blocks: [region('icon', [0, 2])] },
      { file: 'libs/ui/src/label.ts', blocks: [region('label', [0, 1])] },
    ],
  });
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(cache, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

describe("coverage by the package whose tests ran it", () => {
  it('counts each workspace by its own tests and by other packages\' alone', async () => {
    const answer = await ask(['coverage', '--root', repo, '--packages']);

    expect(answer.code).toBe(0);
    expect(answer.out).toMatch(/^ {2}apps\/main\s+1\s+100\.0%\s+0\s+0\.0%$/mu);
    expect(answer.out).toMatch(/^ {2}libs\/ui\s+4\s+25\.0%\s+3\s+75\.0%\s+apps\/main 3 · libs\/specs 1$/mu);
  });

  it('names where in a package only other packages\' tests reach, directory by directory', async () => {
    const answer = await ask(['coverage', '--root', repo, '--packages']);

    const tree = answer.out.slice(answer.out.indexOf("run only by other packages' tests"));
    expect(tree.split('\n').slice(1, 4)).toEqual([
      expect.stringMatching(/^ {2}libs\/ui\/src\/button\/\s+3\s+apps\/main 3 · libs\/specs 1$/u),
      expect.stringMatching(/^ {4}button\.ts\s+2\s+apps\/main 2$/u),
      expect.stringMatching(/^ {4}icon\.ts\s+1\s+apps\/main 1 · libs\/specs 1$/u),
    ]);
    expect(tree).not.toContain('label.ts');
  });

  it('gives a program every file, test files left out', async () => {
    const answer = await ask(['coverage', '--root', repo, '--packages', '--format', 'json']);

    const { ownership } = JSON.parse(answer.out) as { ownership: readonly { file: string; owner: string; others: number }[] };
    expect(ownership.map(({ file, owner, others }) => [file, owner, others])).toEqual([
      ['apps/main/src/main.ts', 'apps/main', 0],
      ['libs/ui/src/button/button.ts', 'libs/ui', 2],
      ['libs/ui/src/button/icon.ts', 'libs/ui', 1],
      ['libs/ui/src/label.ts', 'libs/ui', 0],
    ]);
  });

  it('puts the packages in the pull request comment', async () => {
    const answer = await ask(['coverage', '--root', repo, '--packages', '--format', 'markdown']);

    expect(answer.out).toContain("only other packages' tests");
    expect(answer.out).toContain('| `libs/ui` | 4 | 25.0% | 3 | 75.0% | `apps/main` 3 · `libs/specs` 1 |');
  });

  // In: main.ts by its own test one hop away, and the label by its own.
  // Out: the button's two regions and the icon, from `apps/main` and
  // `libs/specs`, and the label from `apps/main` as well. Accidental: out and
  // not in, the button's two and the icon.
  it('counts each suite in, from its own package within one hop, and out, from any other test', async () => {
    const answer = await ask(['coverage', '--root', repo, '--packages']);

    expect(answer.out).toMatch(/^ {2}unit\s+5\s+2\s+40\.0%\s+4\s+80\.0%\s+3\s+60\.0%$/mu);
  });

  it('gives a program in and out per suite and joined', async () => {
    const answer = await ask(['coverage', '--root', repo, '--packages', '--format', 'json']);

    const { earned } = JSON.parse(answer.out) as { earned: unknown };
    const unit = { regions: 5, in: 2, out: 4, accidental: 3, unmeasured: 0 };
    expect(earned).toEqual({ suites: [{ name: 'unit', kind: 'unit', ...unit }], total: unit });
  });

  it('counts in and out over every crossing under a band, since out is any other test', async () => {
    const answer = await ask(['coverage', '--root', repo, '--packages', '--at-distance', '2-', '--format', 'json']);

    const { earned } = JSON.parse(answer.out) as { earned: unknown };
    const unit = { regions: 5, in: 2, out: 4, accidental: 3, unmeasured: 0 };
    expect(earned).toEqual({ suites: [{ name: 'unit', kind: 'unit', ...unit }], total: unit });
  });

  it('puts in and out in the pull request comment', async () => {
    const answer = await ask(['coverage', '--root', repo, '--packages', '--format', 'markdown']);

    expect(answer.out).toContain('| `unit` | 5 | 40.0% | 80.0% | 3 (60.0%) |');
  });

  it('leaves the ownership out without `--packages`', async () => {
    const answer = await ask(['coverage', '--root', repo, '--format', 'json']);

    expect(JSON.parse(answer.out)).not.toHaveProperty('ownership');
    expect(JSON.parse(answer.out)).not.toHaveProperty('earned');
  });
});

describe('coverage counted from the tests near the code they ran', () => {
  // `main.test` reaches the button two imports away and the icon three; the
  // icon's own spec imports it. Within one hop, the button ran under no test.
  it('counts a region as run only when a test within the band of import hops ran it', async () => {
    const answer = await ask(['coverage', '--root', repo, '--packages', '--at-distance', '0-1']);

    expect(answer.code).toBe(0);
    expect(answer.out).toMatch(/^coverage .* counted where the nearest test that ran the code is 0-1 import hops away$/mu);
    expect(answer.out).toMatch(/^ {2}libs\/ui\s+2\s+50\.0%\s+1\s+50\.0%\s+libs\/specs 1$/mu);
  });

  it('gives a program the band beside the counts it narrowed, and no comparison over a base it was not measured on', async () => {
    const answer = await ask(['coverage', '--root', repo, '--at-distance', '2-', '--format', 'json']);

    const json = JSON.parse(answer.out) as { atDistance: unknown; count: { run: number }; suites: readonly { baseMissed?: string }[] };
    expect(json.atDistance).toEqual({ from: 2, unplaced: [], unmeasured: 0 });
    // The icon's nearest test is its own spec, so only the button counts from afar.
    expect(json.count.run).toBe(2);
    expect(json.suites[0]!.baseMissed).toContain('--at-distance');
  });

  it('says the band in the pull request comment', async () => {
    const answer = await ask(['coverage', '--root', repo, '--at-distance', '1', '--format', 'markdown']);

    expect(answer.out).toContain('the recorded suites loaded, counted where the nearest test that ran the code is 1 import hop away.');
  });

  it('refuses a band that is not hop counts', async () => {
    const answer = await ask(['coverage', '--root', repo, '--at-distance', 'near']);

    expect(answer.code).not.toBe(0);
    expect(answer.err).toContain('--at-distance takes hop counts');
  });
});
