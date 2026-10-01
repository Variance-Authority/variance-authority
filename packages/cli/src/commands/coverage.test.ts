import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseLayerFiles, encodeExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
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

/**
 * Publish the fixture's source index, the step CI runs before `coverage`. Under
 * CI `coverage` reads a published index and never builds one, so a fixture that
 * relied on it building one passed locally and failed on every runner.
 */
async function publishIndex(repo: string): Promise<void> {
  const cwd = process.cwd();
  process.chdir(repo);
  try {
    const indexed = await ask(['index']);
    if (indexed.code !== 0) throw new Error(`variance index failed in ${repo}: ${indexed.err}`);
  } finally {
    process.chdir(cwd);
  }
}

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
    expect(answer.out).toMatch(/unit\s+unit\s+3 → 2\s+75\.0% → 66\.7%\s+gained 1 · lost 1 · no longer loads 1 file, 1 had run/u);
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

    expect(answer.out).toContain('| Suite | Regions executed by cases | Compared with baseline |');
    expect(answer.out).toContain('| `checkout` | Unrecorded | Not compared |');
    expect(answer.out).toContain('| unit alone | 1 | 25.0% |');
    expect(answer.out).toContain('source beyond the recordings');
    expect(answer.out).not.toContain('###');
  });

  it.todo('prints each suite\'s count at the last mainline commits, so a trend has somewhere to be read from — needs `variance share` on a mainline to append one row per suite to the history service, and `--history <n>` to read them (spec 0080, item 6)');
  it.todo('writes the markdown answer to the job summary in the GitHub Action whenever the root config declares suites — needs the composite action to run `variance coverage --format markdown` after the suite (spec 0080, item 4)');
});

describe('coverage of the source no suite loaded', () => {
  let repo: string;
  const MAIN = { id: 'm', file: 'apps/main/src/main.test.ts', name: 'boots', stopped: false };
  const files: Record<string, string> = {
    'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit' } }, entrypoints: { 'apps/main': ['src/main.ts'] } }),
    'apps/main/src/main.ts': "import { app } from './app';\napp();\n",
    'apps/main/src/app.ts': "import { button } from '../../../libs/ui/button';\nexport function app() {\n  return button();\n}\n",
    'apps/main/src/orphan.ts': 'export function orphan(a: boolean) {\n  return a ? 1 : 2;\n}\n',
    'apps/main/src/main.test.ts': "import './main';\n",
    'libs/ui/button.ts': '// A button.\nexport function button() {\n  return 1;\n}\n',
    'libs/ui/unused.ts': 'export const unused = 1;\n',
  };
  const bytes = (file: string) => Buffer.byteLength(files[file]!);

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'variance-coverage-source-'));
    execFileSync('git', ['init', '--quiet', repo]);
    for (const [file, text] of Object.entries(files)) {
      await mkdir(dirname(join(repo, file)), { recursive: true });
      await writeFile(join(repo, file), text);
    }
    execFileSync('git', ['add', '.'], { cwd: repo });
    await publishIndex(repo);
    await record(`${testCoverageFile(repo, { suite: 'unit' })}.cases.bin`, {
      tests: [MAIN],
      modules: [
        { file: 'apps/main/src/main.ts', blocks: [region('module', true)] },
        { file: 'apps/main/src/app.ts', blocks: [region('app', true)] },
      ],
    });
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('counts what the declared entry points reach when no directory is named, and nothing none of them reaches', async () => {
    const answer = await ask(['coverage', '--root', repo, '--format', 'json']);

    const said = JSON.parse(answer.out) as { source: { seeds: string; files: number; unloaded: { list: unknown[] } } };
    expect(said.source.seeds).toBe('entrypoints');
    expect(said.source.files).toBe(3);
    expect(said.source.unloaded.list).toEqual([
      { file: 'libs/ui/button.ts', bytes: bytes('libs/ui/button.ts'), lines: 3, blocks: 2, exports: 1 },
    ]);
  });

  it('lists every source file no suite loaded, with its size, when no entry point is declared', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'variance-coverage-bare-'));
    try {
      execFileSync('git', ['init', '--quiet', bare]);
      for (const [file, text] of Object.entries({ ...files, 'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit' } } }) })) {
        await mkdir(dirname(join(bare, file)), { recursive: true });
        await writeFile(join(bare, file), text);
      }
      execFileSync('git', ['add', '.'], { cwd: bare });
      await publishIndex(bare);
      await record(`${testCoverageFile(bare, { suite: 'unit' })}.cases.bin`, {
        tests: [MAIN],
        modules: [
          { file: 'apps/main/src/main.ts', blocks: [region('module', true)] },
          { file: 'apps/main/src/app.ts', blocks: [region('app', true)] },
        ],
      });
      const said = JSON.parse((await ask(['coverage', '--root', bare, '--format', 'json'])).out) as {
        source: { seeds: string; files: number; unloaded: { list: { file: string }[] } };
      };
      expect(said.source.seeds).toBe('everything');
      expect(said.source.files).toBe(5);
      expect(said.source.unloaded.list.map((size) => size.file)).toEqual(['apps/main/src/orphan.ts', 'libs/ui/button.ts', 'libs/ui/unused.ts']);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it('leaves out a top-level directory the repository does not declare, so an unmeasured site is not a hole in the ratio', async () => {
    const declared = await mkdtemp(join(tmpdir(), 'variance-coverage-root-'));
    try {
      execFileSync('git', ['init', '--quiet', declared]);
      const config = JSON.stringify({ suites: { unit: { kind: 'unit' } }, entrypoints: { '.': ['apps/**', 'libs/**'] } });
      for (const [file, text] of Object.entries({ ...files, 'variance.config.json': config, 'site/app/page.tsx': 'export function page() {\n  return 1;\n}\n' })) {
        await mkdir(dirname(join(declared, file)), { recursive: true });
        await writeFile(join(declared, file), text);
      }
      execFileSync('git', ['add', '.'], { cwd: declared });
      await publishIndex(declared);
      await record(`${testCoverageFile(declared, { suite: 'unit' })}.cases.bin`, {
        tests: [MAIN],
        modules: [{ file: 'apps/main/src/main.ts', blocks: [region('module', true)] }],
      });
      const said = JSON.parse((await ask(['coverage', '--root', declared, '--format', 'json'])).out) as {
        source: { seeds: string; files: number; unloaded: { list: { file: string }[] } };
      };
      expect(said.source.seeds).toBe('entrypoints');
      expect(said.source.files).toBe(5);
      expect(said.source.unloaded.list.map((size) => size.file)).not.toContain('site/app/page.tsx');
    } finally {
      await rm(declared, { recursive: true, force: true });
    }
  });

  it('counts only what the entry points of `--from` reach, and names what they reach that no suite loaded', async () => {
    const answer = await ask(['coverage', '--root', repo, '--from', 'apps/main']);

    expect(answer.code).toBe(0);
    expect(answer.out).toContain('source: 3 files reached from the entry points of apps/main');
    expect(answer.out).toMatch(/recorded by no suite\s+1 file\s+3 lines\s+2 regions/u);
    expect(answer.out).toMatch(/libs\/ui\s+1 file/u);
    expect(answer.out).toContain('total coverage for 2 of the 4 regions: 50.0%');
    expect(answer.out).not.toContain('orphan');
  });
});

describe('coverage of the source the harness loads', () => {
  let repo: string;
  const TEST = { id: 't', file: 'app/src/a.test.ts', name: 'runs', stopped: false };
  const files: Record<string, string> = {
    'variance.config.json': JSON.stringify({
      suites: { unit: { kind: 'unit' } },
      entrypoints: { app: ['src/main.ts'], web: ['src/index.ts'] },
    }),
    'vitest.config.mts': "import { seam } from './tools/seam';\nimport { setup } from './app/src/setup';\nexport default seam(setup);\n",
    'tools/seam.ts': 'export function seam(setup: () => number) {\n  return setup();\n}\n',
    'app/src/main.ts': "import './setup';\nimport { a } from './a';\nimport { b } from './b';\na();\nb();\n",
    'app/src/setup.ts': "import { probe } from '../../libs/probe';\nexport function setup() {\n  return probe();\n}\n",
    'app/src/a.ts': 'export function a() {\n  return 1;\n}\n',
    'app/src/b.ts': 'export function b() {\n  return 2;\n}\n',
    'app/src/a.test.ts': "import { a } from './a';\na();\n",
    'libs/probe.ts': 'export function probe() {\n  return 1;\n}\n',
    'web/src/index.ts': "import { probe } from '../../libs/probe';\nprobe();\n",
  };

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'variance-coverage-harness-'));
    execFileSync('git', ['init', '--quiet', repo]);
    for (const [file, text] of Object.entries(files)) {
      await mkdir(dirname(join(repo, file)), { recursive: true });
      await writeFile(join(repo, file), text);
    }
    execFileSync('git', ['add', '.'], { cwd: repo });
    await publishIndex(repo);
    const at = testCoverageFile(repo, { suite: 'unit' });
    await record(`${at}.cases.bin`, { tests: [TEST], modules: [{ file: 'app/src/a.ts', blocks: [region('a', true)] }] });
    // What the seam writes: each test rests on its own file and on the config it could not instrument.
    await writeTestCoverage(at, {
      version: 3,
      instrumentation: 'fixture-instrumentation',
      tests: [{
        file: TEST.file,
        complete: true,
        preconditions: [{ name: TEST.file, digest: 'source:test' }, { name: 'vitest.config.mts', digest: 'source:config' }],
      }],
      modules: [],
    });
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('counts what the harness loads of each application as run, and says how much of the run it is', async () => {
    const answer = await ask(['coverage', '--root', repo]);

    expect(answer.code).toBe(0);
    expect(answer.out).toMatch(/before reach\s+2 files\s+7 lines\s+4 regions/u);
    expect(answer.out).toMatch(/recorded by no suite\s+3 files\s+10 lines\s+4 regions/u);
    expect(answer.out).toContain('total coverage for 5 of the 9 regions: 55.6%, 80.0% before reach');
    expect(answer.out).toMatch(/ {2}app\s+50\.0%\s+66\.7%\s+62\.5%\s+80\.0%/u);
    expect(answer.out).toMatch(/ {2}web\s+0\.0%\s+—\s+66\.7%\s+100\.0%/u);
  });

  it('says in whole sentences for a pull request what the source index counts', async () => {
    const answer = await ask(['coverage', '--root', repo, '--format', 'markdown']);

    expect(answer.out).toContain(
      '🗂️ The declared entry points import 6 files, directly or through other files, with 9 regions, and **55.6%** of those regions ran. ' +
        '80.0% of what ran is code the test harness loads before any test starts. No suite recorded 3 of those files.',
    );
    expect(answer.out).toContain('<summary>📦 The 3 files no suite recorded, by directory, and the 2 files the test harness loads</summary>');
    expect(answer.out).not.toContain('before reach');
  });

  it('counts before reach within each application, and the harness no entry point reaches nowhere', async () => {
    const said = JSON.parse((await ask(['coverage', '--root', repo, '--format', 'json'])).out) as {
      source: { before: { list: { file: string }[] }; unloaded: { list: { file: string }[] } };
      entries: { from: string; own: { before: { list: { file: string }[] } }; uses: { before: { list: { file: string }[] } } }[];
    };

    expect(said.source.before.list.map((size) => size.file)).toEqual(['app/src/setup.ts', 'libs/probe.ts']);
    expect(said.source.unloaded.list.map((size) => size.file)).toEqual(['app/src/b.ts', 'app/src/main.ts', 'web/src/index.ts']);
    expect(said.entries.map((entry) => [entry.from, entry.uses.before.list.map((size) => size.file)])).toEqual([
      ['app', ['app/src/setup.ts', 'libs/probe.ts']],
      ['web', ['libs/probe.ts']],
    ]);
    expect(said.entries.map((entry) => entry.own.before.list.map((size) => size.file))).toEqual([['app/src/setup.ts'], []]);
  });
});

describe('coverage of a change no suite loads', () => {
  let repo: string;
  let base: string;
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' }).trim();
  const INDEX: Index = { tests: [UNIT], modules: [{ file: 'src/pay.ts', blocks: [region('charge', true), region('void', false)] }] };

  // The mainline recorded the unit suite at one commit; the change since then edits prose.
  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'variance-coverage-unloaded-'));
    execFileSync('git', ['init', '--quiet', repo]);
    await writeFile(join(repo, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src/pay.ts'), 'export function charge() {}\n');
    await writeFile(join(repo, 'README.md'), '# pay\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'base');
    await publishIndex(repo);
    base = join(await mkdtemp(join(tmpdir(), 'variance-coverage-unloaded-base-')), 'unit.cases.bin');
    await record(base, INDEX);
    await writeFile(caseLayerFiles(base).last, JSON.stringify({ commit: git('rev-parse', 'HEAD'), files: [] }));
    await record(`${testCoverageFile(repo, { suite: 'unit' })}.cases.bin`, INDEX);
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(dirname(base), { recursive: true, force: true });
  });

  it('says in one sentence which files changed and that no suite loads them, and prints no count', async () => {
    await writeFile(join(repo, 'README.md'), '# pay\n\nCharges once.\n');
    const since = git('rev-parse', 'HEAD').slice(0, 8);

    const answer = await ask(['coverage', '--root', repo, '--suite', 'unit', '--against', base, '--format', 'markdown']);

    expect(answer.code).toBe(0);
    expect(answer.out).toBe(
      `📊 \`README.md\` changed since the base was recorded at ${since}, and the unit suite does not load it, so coverage is the same as at the base.\n`,
    );
  });

  it('prints the whole count when a changed file is one the suite loads', async () => {
    await writeFile(join(repo, 'src/pay.ts'), 'export function charge() {\n  return 1;\n}\n');

    const answer = await ask(['coverage', '--root', repo, '--suite', 'unit', '--against', base, '--format', 'markdown']);

    expect(answer.out).toContain('| Suite | Regions executed by cases | Compared with baseline |');
    expect(answer.out).not.toContain('does not load');
  });

  it('gives git no base commit that is not an object name, and prints the whole count instead', async () => {
    await writeFile(join(repo, 'src/pay.ts'), 'export function charge() {}\n');
    await writeFile(caseLayerFiles(base).last, JSON.stringify({ commit: '--output=diff.txt', files: [] }));

    const answer = await ask(['coverage', '--root', repo, '--suite', 'unit', '--against', base, '--format', 'markdown']);

    expect(answer.out).toContain('| Suite | Regions executed by cases | Compared with baseline |');
    expect(answer.out).not.toContain('does not load');
    await expect(access(join(repo, 'diff.txt'))).rejects.toThrow();
  });
});

describe('coverage of each package', () => {
  let repo: string;
  const MAIN = { id: 'm', file: 'apps/main/src/main.test.ts', name: 'boots', stopped: false };
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*', 'libs/*'] }),
    'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit' } } }),
    'apps/main/package.json': JSON.stringify({ name: 'main' }),
    'apps/main/src/main.ts': "import { app } from './app';\napp();\n",
    'apps/main/src/app.ts': "import { button } from '../../../libs/ui/button';\nexport function app() {\n  return button();\n}\n",
    'apps/main/src/orphan.ts': 'export function orphan(a: boolean) {\n  return a ? 1 : 2;\n}\n',
    'apps/main/src/main.test.ts': "import './main';\n",
    'libs/ui/package.json': JSON.stringify({ name: 'ui' }),
    'libs/ui/button.ts': 'export function button() {\n  return 1;\n}\n',
    'libs/ui/unused.ts': 'export const unused = 1;\n',
    'fixtures/other/package.json': JSON.stringify({ name: 'other' }),
    'fixtures/other/x.ts': 'export const x = 1;\n',
  };

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'variance-coverage-packages-'));
    execFileSync('git', ['init', '--quiet', repo]);
    for (const [file, text] of Object.entries(files)) {
      await mkdir(dirname(join(repo, file)), { recursive: true });
      await writeFile(join(repo, file), text);
    }
    execFileSync('git', ['add', '.'], { cwd: repo });
    await publishIndex(repo);
    await record(`${testCoverageFile(repo, { suite: 'unit' })}.cases.bin`, {
      tests: [MAIN],
      modules: [
        { file: 'apps/main/src/main.ts', blocks: [region('module', true)] },
        { file: 'apps/main/src/app.ts', blocks: [region('app', true)] },
      ],
    });
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('counts each workspace over its own files and over everything it imports', async () => {
    const answer = await ask(['coverage', '--root', repo, '--packages']);

    expect(answer.code).toBe(0);
    expect(answer.out).toMatch(/own\s+before reach\s+with imports\s+before reach/u);
    expect(answer.out).toMatch(/ {2}apps\/main\s+50\.0%\s+0\.0%\s+33\.3%\s+0\.0%/u);
    expect(answer.out).toMatch(/ {2}libs\/ui\s+0\.0%\s+—\s+0\.0%\s+—/u);
    expect(answer.out).not.toMatch(/^ {2}fixtures\/other/mu);
  });

  it('refuses a directory and every package at once', async () => {
    const answer = await ask(['coverage', '--root', repo, '--packages', '--from', 'apps/main']);

    expect(answer.code).not.toBe(0);
    expect(answer.err).toContain('pass one of them');
  });
});
