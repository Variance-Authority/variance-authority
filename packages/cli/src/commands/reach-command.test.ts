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

async function reach(argv: readonly string[]): Promise<Said> {
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
  it('names the changed file and everything that imports it, one per line', async () => {
    checkout(PYTHON);
    commit(process.cwd(), { 'lib/parse.py': 'def parse(text):\n    return text.strip()\n' }, 'edit');

    const said = await reach(['reach', '--since', 'HEAD~1']);

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
