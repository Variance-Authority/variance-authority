import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';

/**
 * `search` reaches a name no manifest publishes by what its documentation says,
 * as `variance index` published it: the reading that never hands its export
 * list to JavaScript. A helper is found by its doc or not at all, because the
 * person looking for it does not know its name.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-exported-docs-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

function checkout(files: Record<string, string>): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-exported-docs-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch', 'main');
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
  }
  git('add', '-A');
  git('-c', 'user.email=docs@example.test', '-c', 'user.name=docs', 'commit', '--quiet', '-m', 'init');
  process.chdir(root);
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('search over the documentation of unpublished exports', () => {
  it('finds a TypeScript export, a Rust item and a Python function by the words of their docs', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'docs', private: true, workspaces: ['packages/*'] }),
      'packages/lens/package.json': JSON.stringify({ name: '@docs/lens', version: '1.0.0', type: 'module', exports: { '.': './src/index.ts' } }),
      'packages/lens/src/index.ts': 'export const lens = 1;\n',
      'packages/lens/src/owners.ts': '/** The nearest named directory above a path. */\nexport function climb(path: string): string {\n  return path;\n}\n',
      'packages/lens/native/Cargo.toml': '[package]\nname = "lens"\nversion = "0.1.0"\n',
      'packages/lens/native/src/lib.rs': "/// Any path's package, tracked or not.\n#[inline]\npub(crate) fn owner_of() {}\n",
      'packages/lens/tools/ledger.py': 'def settle():\n    """Balance the ledger,\n    once a day.\n    """\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const directory = await run(['ask', 'search', '--query', 'named directory']);
    expect(directory.err).toBe('');
    expect(directory.out).toContain('climb');
    expect(directory.out).toContain('The nearest named directory above a path.');

    const tracked = await run(['ask', 'search', '--query', 'tracked or not']);
    expect(tracked.out).toContain('owner_of');
    expect(tracked.out).toContain("Any path's package, tracked or not.");

    const balance = await run(['ask', 'search', '--query', 'balance the ledger']);
    expect(balance.out).toContain('settle');
    expect(balance.out).toContain('Balance the ledger, once a day.');
  });

  it('finds a renamed name by a word its doc still writes, and never by a word only prose writes', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'docs', private: true, workspaces: ['packages/*'] }),
      'packages/lens/package.json': JSON.stringify({ name: '@docs/lens', version: '1.0.0', type: 'module', exports: { '.': './src/index.ts' } }),
      'packages/lens/src/index.ts': 'export const lens = 1;\n',
      'packages/lens/src/hold.ts': '/** Close the turnstile until the run settles. */\nexport function hold(): void {}\n',
      'docs/specs/0001-hold.md': '# The gate\n\nThe gate was renamed `hold`.\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect((await run(['ask', 'search', '--query', 'turnstile'])).out).toContain('hold');
    const gate = await run(['ask', 'search', '--query', 'gate']);
    expect(gate.code).toBe(EXIT_CLEAN);
    expect(gate.out).not.toContain('hold.ts');
  });
});
