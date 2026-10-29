import { execFile, execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { repositoryLayers, testCoverageFile } from '@variance-authority/sense/test-selection';
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

const UNKNOWN = 'is in a text a case ran over, but a run over another text has landed there since, so which case ran it is not known.';

const git = (at: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: at, stdio: 'pipe', encoding: 'utf8' }).trim();

const ask = async (root: string, ...argv: string[]): Promise<{ readonly answer: Covering; readonly text: string }> => {
  const answer = await covering(parseCoveringArgs(readFlags(['--root', root, ...argv], 'covering', flagsFor('covering'), synopsisFor('covering'))));
  return { answer, text: formatCovering(answer, 'text', Date.now()) };
};

const vitest = (root: string, ...argv: string[]) => promisify(execFile)(
  process.execPath,
  [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(root, 'vitest.config.ts'), ...argv],
  { cwd: root, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: testCoverageFile(root) } },
);

/** A committed checkout of `files` beside the repository's modules, with a vitest config that records the source. */
async function checkout(files: Readonly<Record<string, string>>): Promise<string> {
  // The temporary directory is a link on some systems, and the runner names files by their real path.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'variance-covering-overwritten-')));
  await mkdir(join(root, 'src'));
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, 'package.json'), '{ "name": "overwritten-fixture", "private": true, "type": "module" }\n');
  await writeFile(join(root, '.gitignore'), 'node_modules\n');
  await writeFile(join(root, 'vitest.config.ts'), CONFIG);
  await Promise.all(Object.entries(files).map(([path, text]) => writeFile(join(root, path), text)));
  git(root, ['init', '--quiet', '--initial-branch', 'main']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'first']);
  return root;
}

describe('a region a run in part cut to another text, with a case that ran it at the commit', () => {
  const cwd = process.cwd();
  const previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  let root: string;
  let cache: string;

  beforeAll(async () => {
    cache = await mkdtemp(join(tmpdir(), 'variance-covering-overwritten-cache-'));
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
    root = await checkout({ 'src/a.ts': SOURCE, 'src/a.test.ts': TEST });
    await vitest(root);
    await writeFile(join(root, 'src/a.ts'), SOURCE.replace('  return more;', '  return more + 1;'));
    await vitest(root, 'src/a.test.ts', '-t', 'alpha doubles');
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
    const eight = await ask(root, '--file', 'src/a.ts', '--line', '8');
    expect(eight.text).toContain(`Line 8 of src/a.ts ${UNKNOWN}`);
    expect(eight.text).not.toMatch(/No named test covered|unwalked/);
    expect(eight.answer.overwritten).toEqual([{ startLine: 8, endLine: 8 }]);
    const nine = await ask(root, '--file', 'src/a.ts', '--line', '9');
    expect(nine.text).toContain(`Line 9 of src/a.ts ${UNKNOWN}`);
    expect(nine.answer.overwritten).toEqual([{ startLine: 9, endLine: 9 }]);
  });

  it('says every line of the region so at --lines and --function', async () => {
    const lines = await ask(root, '--file', 'src/a.ts', '--line', '6-10');
    expect(lines.text).not.toMatch(/No named test covered|unwalked/);
    expect(lines.answer.overwritten).toEqual([{ startLine: 7, endLine: 9 }]);
    const beta = await ask(root, '--file', 'src/a.ts', '--function', 'beta');
    expect(beta.text).not.toMatch(/No named test covered|no case covered|unwalked/);
    expect(beta.text).toContain('which case ran');
  });

  it('never calls the region unwalked in the whole file, nor under --since', async () => {
    const file = await ask(root, '--file', 'src/a.ts');
    expect(file.text).not.toContain('unwalked');
    await writeFile(join(root, 'src/a.ts'), (await readFile(join(root, 'src/a.ts'), 'utf8')).replace('const again = more;', 'const again = more * 1;'));
    try {
      const since = await ask(root, '--since', 'HEAD');
      expect(since.text).not.toMatch(/no case covered|unwalked/);
      expect(since.text).toContain('which case ran');
    } finally {
      git(root, ['checkout', '--quiet', 'src/a.ts']);
    }
  });
});

// The same cut, then a run of another test file over the committed text, which
// numbers the record in it again. The cases that ran `beta` there still did
// not land on its region, so which one ran a line of it is still not known,
// and the answer does not say the record is numbered in another text.
const NUMBERED = `export function alpha(value: number): number {
  return value * 2;
}

export function beta(value: number): number {
  const more = value + 1;
  return more;
}

export function gamma(value: number): number {
  if (value > 0) {
    return value - 1;
  }
  return 0;
}
`;

const BOTH = `import { describe, expect, it } from 'vitest';
import { alpha, beta, gamma } from './a.js';

describe('a', () => {
  it('alpha doubles', () => expect(alpha(2)).toBe(4));
  it('beta adds', () => expect(beta(1)).toBe(2));
  it('gamma subtracts', () => expect(gamma(2)).toBe(1));
});
`;

const ZERO = `import { describe, expect, it } from 'vitest';
import { gamma } from './a.js';

describe('b', () => {
  it('gamma zero', () => expect(gamma(0)).toBe(0));
});
`;

describe('a region a run in part cut to another text, after a later run numbers the record in the asked one', () => {
  const cwd = process.cwd();
  const previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  let root: string;
  let cache: string;

  beforeAll(async () => {
    cache = await mkdtemp(join(tmpdir(), 'variance-covering-overwritten-cache-'));
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
    root = await checkout({ 'src/a.ts': NUMBERED, 'src/a.test.ts': BOTH, 'src/b.test.ts': ZERO });
    await vitest(root);
    await writeFile(join(root, 'src/a.ts'), `// header one\n// header two\n${NUMBERED.replace('const more = value + 1;', 'const more = value + 1 + 0;')}`);
    await vitest(root, 'src/a.test.ts', '-t', 'alpha doubles');
    git(root, ['checkout', '--quiet', 'src/a.ts']);
    await vitest(root, 'src/b.test.ts');
    await updateSourceIndex(root);
    process.chdir(root);
  }, 120_000);

  afterAll(async () => {
    process.chdir(cwd);
    if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
    else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
    await Promise.all([root, cache].map((path) => rm(path, { recursive: true, force: true })));
  });

  it('says a line of the region is not known to have run without saying the record is numbered in another text', async () => {
    const six = await ask(root, '--file', 'src/a.ts', '--line', '6');
    expect(six.answer.frame).toBe('recorded');
    expect(six.answer.overwritten).toEqual([{ startLine: 6, endLine: 6 }]);
    expect(six.text).toContain(`Line 6 of src/a.ts ${UNKNOWN}`);
    expect(six.text).not.toContain('numbered in another');
  });

  it('says so of the region under --function, --lines and the whole file', async () => {
    for (const argv of [['--function', 'beta'], ['--line', '5-8'], []]) {
      const { text } = await ask(root, '--file', 'src/a.ts', ...argv);
      expect(text).toMatch(/so which (other )?case ran/);
      expect(text).not.toContain('numbered in another');
    }
  });
});

// A full run over an uncommitted edit inside `alpha`, its kept text removed as a
// cleared cache leaves it, and a run of the one case that does not enter `beta`
// over the committed text. The landing cannot find the text `beta adds` ran
// over, so where its regions stand is not known: no line of the module is
// measured absence for it.
describe('a module a run in part laid over a text the landing cannot find', () => {
  const cwd = process.cwd();
  const previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  let root: string;
  let cache: string;

  beforeAll(async () => {
    cache = await mkdtemp(join(tmpdir(), 'variance-covering-overwritten-cache-'));
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
    root = await checkout({ 'src/a.ts': SOURCE, 'src/a.test.ts': TEST });
    await writeFile(join(root, 'src/a.ts'), SOURCE.replace('  return value * 2;', '  return value * 2 + 0;'));
    await vitest(root);
    const kept = join(repositoryLayers(root).top, '.texts');
    await access(kept);
    await rm(kept, { recursive: true });
    git(root, ['checkout', '--quiet', 'src/a.ts']);
    await vitest(root, 'src/a.test.ts', '-t', 'alpha doubles');
    await updateSourceIndex(root);
    process.chdir(root);
  }, 120_000);

  afterAll(async () => {
    process.chdir(cwd);
    if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
    else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
    await Promise.all([root, cache].map((path) => rm(path, { recursive: true, force: true })));
  });

  it('says a line only the case it could not place ran is not known to have run, never that no named test covered it', async () => {
    const seven = await ask(root, '--file', 'src/a.ts', '--line', '7');
    expect(seven.text).toContain(`Line 7 of src/a.ts ${UNKNOWN}`);
    expect(seven.text).not.toMatch(/No named test covered|unwalked/);
    expect(seven.answer.overwritten).toEqual([{ startLine: 7, endLine: 7 }]);
  });

  it('says so of the function it ran and of the whole file', async () => {
    for (const argv of [['--function', 'beta'], []]) {
      const { text } = await ask(root, '--file', 'src/a.ts', ...argv);
      expect(text).toContain('which case ran');
      expect(text).not.toMatch(/No named test covered|no case covered|unwalked/);
    }
  });
});
