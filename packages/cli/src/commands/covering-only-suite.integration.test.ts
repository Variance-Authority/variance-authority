import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { run } from './ask-packages.fixture.js';

// #1074: a wrap that names no suite records into the only one declared, the
// record `variance covering` reads, and stops naming every suite among several.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');

const CONFIG = `import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

export default withTestSelection(defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), test: { include: ['src/*.test.ts'] } }));
`;

const git = (at: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: at, stdio: 'pipe', encoding: 'utf8' }).trim();

/** A committed checkout beside the repository's modules, declaring `suites`, its Vitest config wrapped with no suite named. */
async function checkout(suites: Readonly<Record<string, { readonly kind: string }>>): Promise<string> {
  // The runner names files by their real path, and a temporary directory is a link on some systems.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'variance-covering-only-suite-')));
  await mkdir(join(root, 'src'));
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  const files = {
    '.gitignore': 'node_modules\n',
    'package.json': '{ "name": "only-suite-fixture", "private": true, "type": "module" }\n',
    'variance.config.json': JSON.stringify({ suites }),
    'vitest.config.ts': CONFIG,
    'src/total.ts': 'export function total(): number {\n  return 1;\n}\n',
    'src/total.test.ts': "import { expect, it } from 'vitest';\nimport { total } from './total.js';\n\nit('totals', () => expect(total()).toBe(1));\n",
  };
  await Promise.all(Object.entries(files).map(([path, text]) => writeFile(join(root, path), text)));
  git(root, ['init', '--quiet', '--initial-branch', 'main']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'first']);
  return root;
}

/** `vitest run` in `root`, its exit code and both streams. */
async function vitest(root: string): Promise<{ readonly code: number; readonly output: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run'], { cwd: root });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, output: failed.stdout + failed.stderr };
  }
}

describe('a wrapped run that names no suite', () => {
  const cwd = process.cwd();
  const previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  const roots: string[] = [];
  let cache: string;

  beforeAll(async () => {
    cache = await mkdtemp(join(tmpdir(), 'variance-covering-only-suite-cache-'));
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  });

  afterAll(async () => {
    process.chdir(cwd);
    if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
    else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
    await Promise.all([cache, ...roots].map((path) => rm(path, { recursive: true, force: true })));
  });

  it('records into the only declared suite, the record `variance covering` reads', async () => {
    const root = await checkout({ unit: { kind: 'unit' } });
    roots.push(root);
    expect((await vitest(root)).code).toBe(0);

    process.chdir(root);
    const { code, out } = await run(['covering', '--file', 'src/total.ts']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('unit (unit):');
    expect(out).toContain('src/total.test.ts');
    expect(out).toContain('totals');
  }, 120_000);

  it('stops among two declared suites, naming both', async () => {
    const root = await checkout({ unit: { kind: 'unit' }, stories: { kind: 'visual' } });
    roots.push(root);
    const { code, output } = await vitest(root);
    expect(code).not.toBe(0);
    expect(output).toContain('declares the suites "stories", "unit", and none is named');
    expect(output).not.toContain('totals');
  }, 120_000);
});
