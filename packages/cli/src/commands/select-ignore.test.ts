import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * `variance select` over a file a suite declares it ignores.
 *
 * `src/button.ts` imports a stylesheet and an image, and the record has no row
 * for either, so each goes to the test that loaded `button.ts`. A unit suite
 * that renders no pixel says, in `suites.<name>.ignore`, that neither moves any
 * of its tests: a matching changed file leaves that suite's change before it is
 * read, and is named as ignored. Another suite reads the same change as before.
 */
describe('a changed file a suite ignores', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-ignore-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('runs the test of its importer in a suite that ignores nothing', async () => {
    const root = await recorded({ unit: { kind: 'unit' } });

    write(root, 'src/button.css', '.button { color: blue; }\n');
    const said = await select(root);

    expect(said.out).toBe('test/beta.test.ts\n');
    expect(said.err).not.toContain('the suite ignores');
  });

  it.each([
    ['a stylesheet', 'src/button.css', '.button { color: blue; }\n'],
    ['an image', 'src/logo.png', 'not the same pixels\n'],
  ])('runs nothing for %s the suite ignores, and names it', async (_kind, file, text) => {
    const root = await recorded({ unit: { kind: 'unit', ignore: ['**/*.css', '**/*.png'] } });

    write(root, file, text);
    const said = await select(root);

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\n');
    expect(said.err).toContain('the suite ignores 1 changed file by its `ignore`');
    expect(said.err).toContain(`read ${file}: unread (the suite's \`ignore\` matches it)`);
  });

  it('reads the files it does not ignore in the same change', async () => {
    const root = await recorded({ unit: { kind: 'unit', ignore: ['**/*.png'] } });

    write(root, 'src/button.css', '.button { color: blue; }\n');
    write(root, 'src/logo.png', 'not the same pixels\n');
    const said = await select(root);

    expect(said.out).toBe('test/beta.test.ts\n');
    expect(said.err).toContain('the suite ignores 1 changed file by its `ignore`');
    expect(said.err).toContain("read src/logo.png: unread (the suite's `ignore` matches it)");
  });

  it('lists what it ignored in `--format json`, apart from what it could not read', async () => {
    const root = await recorded({ unit: { kind: 'unit', ignore: ['**/*.css'] } });

    write(root, 'src/button.css', '.button { color: blue; }\n');
    const said = await selectOutput({ cwd: root, format: 'json', suite: 'unit' });

    expect(JSON.parse(said.out)).toMatchObject({ ignored: ['src/button.css'], unread: [] });
  });

  it('ignores a file the suite rests on, so it does not run the suite whole', async () => {
    const root = await recorded({ unit: { kind: 'unit', before: ['src/button.css'], ignore: ['**/*.css'] } });

    write(root, 'src/button.css', '.button { color: blue; }\n');
    const said = await select(root);

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\n');
  });

  it('ignores by the suite it selects for, not by another suite', async () => {
    const root = await recorded({ unit: { kind: 'unit' }, stories: { kind: 'visual', ignore: ['**/*.css'] } });

    write(root, 'src/button.css', '.button { color: blue; }\n');
    const said = await select(root);

    expect(said.out).toBe('test/beta.test.ts\n');
  });
});

const PAD = ['export function pad(text: string): string {', "  return text.padStart(4, ' ');", '}', ''].join('\n');
const BUTTON = ["import './button.css';", "import logo from './logo.png';", 'export const button = logo;', ''].join('\n');

const FILES: Readonly<Record<string, string>> = {
  'src/pad.ts': PAD,
  'src/button.ts': BUTTON,
  'src/button.css': '.button { color: red; }\n',
  'src/logo.png': 'pixels\n',
  'test/alpha.test.ts':
    "import { expect, it } from 'vitest';\nimport { button } from '../src/button';\nit('renders', () => expect(button).toBeDefined());\n",
  'test/beta.test.ts':
    "import { expect, it } from 'vitest';\nimport { pad } from '../src/pad';\nit('pads', () => expect(pad('x')).toBe('   x'));\n",
  'package.json': JSON.stringify({ name: 'fixture' }),
};

/** A checkout declaring `suites`, its index built, and a `unit` record of two tests at its head. */
async function recorded(suites: unknown): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'va-select-ignore-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  for (const [file, text] of Object.entries(FILES)) write(root, file, text);
  write(root, 'variance.config.json', JSON.stringify({ suites }));
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  await writeTestCoverage(testCoverageFile(root, { suite: 'unit' }), snapshot(git(['rev-parse', 'HEAD'])));
  process.chdir(root);
  await indexOutput({ cwd: root });
  return root;
}

async function select(root: string) {
  return await selectOutput({ cwd: root, format: 'plain', suite: 'unit' });
}

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/** One module row per source file, each entered by the test that imports it; the stylesheet and the image have none. */
function snapshot(commit: string): TestCoverage {
  const row = (file: string, text: string, test: string, name: string) => ({
    file,
    sourceDigest: digestString(text),
    instrumented: true,
    blocks: [
      {
        ordinal: 0,
        kind: 'module' as const,
        digest: digestString(`module ${file}`),
        name,
        path: 'module',
        startLine: 1,
        endLine: text.split('\n').length,
        source: true,
        testFiles: [test],
      },
    ],
  });
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/alpha.test.ts', complete: true, preconditions: [] },
      { file: 'test/beta.test.ts', complete: true, preconditions: [] },
    ],
    modules: [row('src/button.ts', BUTTON, 'test/alpha.test.ts', 'button.ts'), row('src/pad.ts', PAD, 'test/beta.test.ts', 'pad.ts')],
  };
}
