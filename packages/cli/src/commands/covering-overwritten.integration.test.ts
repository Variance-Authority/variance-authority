import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering, type Covering } from './covering.js';

// A full run, then an edit inside `beta`, a run of the one case that does not
// enter it, and a checkout back to the committed text. The run in part lays
// the record in the edited text, where the edit reached `beta`'s region, so
// the case that ran it at the commit, `beta adds`, did not land there. Which
// case runs `beta` now is not known: no line of it is measured absence.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');

const SOURCE = `export function alpha(value: number): number {
  return value * 2;
}

// beta adds one
export function beta(value: number): number {
  const more = value + 1;
  const again = more;
  return more;
}
`;

const TEST = `import { describe, expect, it } from 'vitest';
import { alpha, beta } from './a.js';

describe('a', () => {
  it('alpha doubles', () => expect(alpha(2)).toBe(4));
  it('beta adds', () => expect(beta(1)).toBe(2));
});
`;

const CONFIG = `import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');

export default withTestSelection(
  defineConfig({ root, test: { include: ['src/*.test.ts'], environment: 'node' } }),
  { coverageFile: process.env['VARIANCE_AUTHORITY_COVERAGE']!, include: (file) => file.startsWith(source) && !file.endsWith('.test.ts') },
);
`;

const UNKNOWN = 'is in a text a case ran over, but the record\'s lines are numbered in another, so which case ran it is not known.';

const git = (at: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: at, stdio: 'pipe', encoding: 'utf8' }).trim();

describe('a region a run in part cut to another text, with a case that ran it at the commit', () => {
  const cwd = process.cwd();
  const previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  let root: string;
  let cache: string;
  const ask = async (...argv: string[]): Promise<{ readonly answer: Covering; readonly text: string }> => {
    const answer = await covering(parseCoveringArgs(readFlags(['--root', root, ...argv], 'covering', flagsFor('covering'), synopsisFor('covering'))));
    return { answer, text: formatCovering(answer, 'text', Date.now()) };
  };
  const vitest = (...argv: string[]) => promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(root, 'vitest.config.ts'), ...argv],
    { cwd: root, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: testCoverageFile(root) } },
  );

  beforeAll(async () => {
    // The temporary directory is a link on some systems, and the runner names files by their real path.
    root = await realpath(await mkdtemp(join(tmpdir(), 'variance-covering-overwritten-')));
    cache = await mkdtemp(join(tmpdir(), 'variance-covering-overwritten-cache-'));
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
    await mkdir(join(root, 'src'));
    await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
    await writeFile(join(root, 'package.json'), '{ "name": "overwritten-fixture", "private": true, "type": "module" }\n');
    await writeFile(join(root, '.gitignore'), 'node_modules\n');
    await writeFile(join(root, 'vitest.config.ts'), CONFIG);
    await writeFile(join(root, 'src/a.ts'), SOURCE);
    await writeFile(join(root, 'src/a.test.ts'), TEST);
    git(root, ['init', '--quiet', '--initial-branch', 'main']);
    git(root, ['config', 'user.email', 'fixture@example.test']);
    git(root, ['config', 'user.name', 'Fixture']);
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'first']);
    await vitest();
    await writeFile(join(root, 'src/a.ts'), SOURCE.replace('  return more;', '  return more + 1;'));
    await vitest('src/a.test.ts', '-t', 'alpha doubles');
    git(root, ['checkout', '--quiet', 'src/a.ts']);
    await updateSourceIndex(root);
    process.chdir(root);
  }, 120_000);

  afterAll(async () => {
    process.chdir(cwd);
    if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
    else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
    await Promise.all([root, cache].map((path) => rm(path, { recursive: true, force: true })));
  });

  it('says a line of the region the edit did not write as it says the line the edit wrote', async () => {
    const eight = await ask('--file', 'src/a.ts', '--line', '8');
    expect(eight.text).toContain(`Line 8 of src/a.ts ${UNKNOWN}`);
    expect(eight.text).not.toMatch(/No named test covered|unwalked/);
    expect(eight.answer.overwritten).toEqual([{ startLine: 8, endLine: 8 }]);
    const nine = await ask('--file', 'src/a.ts', '--line', '9');
    expect(nine.text).toContain(`Line 9 of src/a.ts ${UNKNOWN}`);
    expect(nine.answer.overwritten).toEqual([{ startLine: 9, endLine: 9 }]);
  });

  it('says every line of the region so at --lines and --function', async () => {
    const lines = await ask('--file', 'src/a.ts', '--line', '6-10');
    expect(lines.text).not.toMatch(/No named test covered|unwalked/);
    expect(lines.answer.overwritten).toEqual([{ startLine: 7, endLine: 9 }]);
    const beta = await ask('--file', 'src/a.ts', '--function', 'beta');
    expect(beta.text).not.toMatch(/No named test covered|no case covered|unwalked/);
    expect(beta.text).toContain('which case ran');
  });

  it('never calls the region unwalked in the whole file, nor under --since', async () => {
    const file = await ask('--file', 'src/a.ts');
    expect(file.text).not.toContain('unwalked');
    await writeFile(join(root, 'src/a.ts'), (await readFile(join(root, 'src/a.ts'), 'utf8')).replace('const again = more;', 'const again = more * 1;'));
    try {
      const since = await ask('--since', 'HEAD');
      expect(since.text).not.toMatch(/no case covered|unwalked/);
      expect(since.text).toContain('which case ran');
    } finally {
      git(root, ['checkout', '--quiet', 'src/a.ts']);
    }
  });
});
