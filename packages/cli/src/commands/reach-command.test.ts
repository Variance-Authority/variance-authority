import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * `variance reach` end to end, in a checkout of four languages and no config.
 *
 * Run through `main` rather than through `reachOutput`, because the property
 * being asserted is about the *process*: what came out of stdout, and what the
 * shell that piped it was told by the exit code. Those two are the contract —
 * a caller writes `variance reach --since main | xargs pytest` and the only
 * things standing between them and a green build over an unread change are an
 * exit code and a stream.
 *
 * So each case asserts both, separately. A command that exited `2` and still
 * printed a path, or exited `0` and printed nothing, is broken in a way that a
 * single combined assertion would let through.
 */

const cwd = process.cwd();
afterEach(() => process.chdir(cwd));

function git(at: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd: at, stdio: 'pipe' });
}

function commit(at: string, files: Readonly<Record<string, string>>, message: string): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(at, path, '..'), { recursive: true });
    writeFileSync(join(at, path), body);
  }
  git(at, ['add', '-A']);
  git(at, ['commit', '--quiet', '-m', message]);
}

/** A checkout with no `variance.config.json` in it, which is the whole point. */
function checkout(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'va-reach-'));
  mkdirSync(root, { recursive: true });
  git(root, ['init', '--quiet', '--initial-branch', 'main']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  commit(root, files, 'the checkout');
  process.chdir(root);
  return root;
}

interface Said {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** The pipeline's two steps: publish the index, then ask it. */
async function reach(argv: readonly string[]): Promise<Said> {
  const index = argv.includes('--no-git') ? ['index', '--no-git'] : ['index'];
  await main(index, { out: () => {}, err: () => {} });
  let out = '';
  let err = '';
  const code = await main(argv, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

const PYTHON = {
  'app/main.py': 'from lib.parse import parse\n',
  'app/other.py': 'import lib.parse\n',
  'lib/parse.py': 'def parse(text):\n    return text\n',
  'lib/__init__.py': '',
};

describe('what a diff reaches, on stdout', () => {
  it.each([{ flags: [] }, { flags: ['--no-git'] }])('names the changed file and its importers with flags $flags', async ({ flags }) => {
    checkout(PYTHON);
    commit(process.cwd(), { 'lib/parse.py': 'def parse(text):\n    return text.strip()\n' }, 'edit');

    const said = await reach(['reach', '--since', 'HEAD~1', ...flags]);

    expect(said.code).toBe(EXIT_CLEAN);
    expect(said.out.trim().split('\n').sort()).toEqual([
      'app/main.py',
      'app/other.py',
      'lib/parse.py',
    ]);
    // Nothing explaining the answer may reach the stream a runner reads.
    expect(said.err).toMatch(/3 files reached from 1 changed file/);
  });

  it('exits 2 and writes nothing to stdout when no changed file is in the graph', async () => {
    checkout(PYTHON);
    commit(process.cwd(), { 'Dockerfile': 'FROM python:3.13\n' }, 'the image');

    const said = await reach(['reach', '--since', 'HEAD~1']);

    // The two facts, asserted as two. A short list is the failure this command
    // is shaped to refuse, and an empty one is the shortest list there is.
    expect(said.code).toBe(EXIT_OPERATOR);
    expect(said.out).toBe('');
    expect(said.err).toMatch(/says nothing about what it reaches/);
  });

  it('exits 2 and writes nothing to stdout when nothing changed at all', async () => {
    checkout(PYTHON);

    const said = await reach(['reach', '--since', 'HEAD']);

    expect(said.code).toBe(EXIT_OPERATOR);
    expect(said.out).toBe('');
    expect(said.err).toMatch(/nothing to walk from/);
  });

  it('leaves a path no reader claims out of the walk, and names it on stderr', async () => {
    checkout(PYTHON);
    commit(
      process.cwd(),
      { 'lib/parse.py': 'def parse(text):\n    return text.strip()\n', 'uv.lock': 'version = 1\n' },
      'the pin and the edit',
    );

    const said = await reach(['reach', '--since', 'HEAD~1']);

    expect(said.code).toBe(EXIT_CLEAN);
    expect(said.out).not.toMatch(/uv\.lock/);
    expect(said.err).toMatch(/uv\.lock/);
  });

  it('answers across languages in one walk, because a graph has one kind of node', async () => {
    // The claim `polyglot` makes, asserted rather than described: one diff, two
    // languages, and the same command answering about both without being told
    // which is which.
    checkout({
      ...PYTHON,
      'Sources/Core/Lens.swift': 'public struct Lens {}\n',
      'Sources/App/Main.swift': 'import Core\n',
      'Package.swift': '// swift-tools-version:5.9\n',
    });
    commit(
      process.cwd(),
      {
        'lib/parse.py': 'def parse(text):\n    return text.strip()\n',
        'Sources/Core/Lens.swift': 'public struct Lens { public let at: Int = 0 }\n',
      },
      'both',
    );

    const said = await reach(['reach', '--since', 'HEAD~1']);

    expect(said.code).toBe(EXIT_CLEAN);
    const files = said.out.trim().split('\n');
    expect(files).toContain('app/main.py');
    // Swift has no grain below the target, so a change to `Core` reaches every
    // file that imports `Core` — which is the over-reach the language forces.
    expect(files).toContain('Sources/App/Main.swift');
  });
});

describe('a changed file that runs what it ran before', () => {
  const TYPESCRIPT = {
    'package.json': '{ "name": "shop", "type": "module" }\n',
    'src/limits.ts': 'export function clamp(value: number): number {\n  return Math.min(value, 10);\n}\n',
    'src/cart.ts': "import { clamp } from './limits.js';\nexport const total = (n: number) => clamp(n);\n",
    'src/cart.test.ts': "import { total } from './cart.js';\ntotal(1);\n",
  };

  it('leaves a file whose edit was a comment and a type out of the walk, and names it on stderr', async () => {
    checkout(TYPESCRIPT);
    commit(
      process.cwd(),
      {
        'src/limits.ts':
          '/** The cap on a line. */\nexport function clamp(value: number): 0 | number {\n  return Math.min(value, 10);\n}\n',
        'src/cart.ts': "import { clamp } from './limits.js';\nexport const total = (n: number) => clamp(n + 1);\n",
      },
      'a comment and a fix',
    );

    const said = await reach(['reach', '--since', 'HEAD~1']);

    expect(said.code).toBe(EXIT_CLEAN);
    expect(said.out.trim().split('\n').sort()).toEqual(['src/cart.test.ts', 'src/cart.ts']);
    expect(said.err).toMatch(/src\/limits\.ts changes nothing that runs/);
  });

  it('exits 2 and writes nothing to stdout when every changed file runs what it ran before', async () => {
    checkout(TYPESCRIPT);
    commit(
      process.cwd(),
      { 'src/limits.ts': 'export function clamp(value: number): number {\n  // The cap on a line.\n  return Math.min(value, 10);\n}\n' },
      'a comment',
    );

    const said = await reach(['reach', '--since', 'HEAD~1']);

    expect(said.code).toBe(EXIT_OPERATOR);
    expect(said.out).toBe('');
    expect(said.err).toMatch(/src\/limits\.ts changes nothing that runs, so it seeds nothing/);
  });
});

describe('a changed file read by the exports it changed', () => {
  const SHOP = {
    'package.json': '{ "name": "shop", "type": "module" }\n',
    'src/cart.ts':
      'export function total(n: number): number {\n  return n * 2;\n}\n' +
      "export function label(): string {\n  return 'cart';\n}\n",
    'src/index.ts': "export { total as sum, label } from './cart.js';\n",
    'test/total.test.ts': "import { total } from '../src/cart.js';\ntotal(1);\n",
    'test/label.test.ts': "import { label } from '../src/cart.js';\nlabel();\n",
    'test/sum.test.ts': "import { sum } from '../src/index.js';\nsum(1);\n",
    'test/badge.test.ts': "import { label } from '../src/index.js';\nlabel();\n",
    'test/whole.test.ts': "import * as cart from '../src/cart.js';\ncart.label();\n",
  };

  it('reaches the importers of the export that moved, through a barrel, and not the others', async () => {
    checkout(SHOP);
    commit(process.cwd(), { 'src/cart.ts': SHOP['src/cart.ts'].replace('n * 2', 'n * 3') }, 'double to triple');

    const said = await reach(['reach', '--since', 'HEAD~1']);

    expect(said.code).toBe(EXIT_CLEAN);
    expect(said.out.trim().split('\n').sort()).toEqual([
      'src/cart.ts',
      'src/index.ts',
      'test/sum.test.ts',
      'test/total.test.ts',
      'test/whole.test.ts',
    ]);
    expect(said.err).toMatch(/src\/cart\.ts changes total; only files that import a changed export are walked/);
  });

  it('names the changed exports in the JSON it prints', async () => {
    checkout(SHOP);
    commit(process.cwd(), { 'src/cart.ts': SHOP['src/cart.ts'].replace("'cart'", "'basket'") }, 'rename the label');

    const said = await reach(['reach', '--since', 'HEAD~1', '--format', 'json']);

    expect(JSON.parse(said.out)).toMatchObject({ exports: { 'src/cart.ts': ['label'] } });
    expect(JSON.parse(said.out).files).not.toContain('test/total.test.ts');
  });
});
