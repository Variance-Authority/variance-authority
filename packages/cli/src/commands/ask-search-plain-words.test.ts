import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `search` asked in plain words: the words a declaration's name or doc holds,
 * in another order and with others between them, so the query is no substring
 * of either. A name its file keeps to itself is asked for this way more than
 * any other, because whoever looks for it does not know what it is called.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-plain-words-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const DECLARED = {
  'packages/kit/src/money/restart.ts': [
    'export const restart = (argv: readonly string[]): number => relaunch(argv);',
    '',
    '/** Start the program again in a process of its own. */',
    'function relaunch(argv: readonly string[]): number {',
    '  return argv.length;',
    '}',
    '',
  ].join('\n'),
  'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n',
  'packages/kit/src/lib.rs': [
    'pub fn respawn(argv: &[String]) -> i32 {',
    '    rerun(argv)',
    '}',
    '',
    '/// Start the program again,',
    '/// in a process of its own.',
    'fn rerun(argv: &[String]) -> i32 {',
    '    argv.len() as i32',
    '}',
    '',
  ].join('\n'),
  'packages/kit/kit/restart.py': [
    'def reboot(argv):',
    '    return _reopen(argv)',
    '',
    'def _reopen(argv):',
    '    """Start the program again in a process of its own."""',
    '    return len(argv)',
    '',
    'def _spawn_child_process(argv):',
    '    return argv',
    '',
  ].join('\n'),
};

describe('search asked in plain words', () => {
  it('finds a declaration no file exports, in TypeScript, Rust and Python, by words its doc holds apart', async () => {
    checkout(DECLARED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'search', '--query', 'process the program again']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^relaunch \[function\] — @acme\/kit · packages\/kit\/src\/money\/restart\.ts:4 \[holds: again, process, program\]$/m);
    expect(out).toMatch(/^rerun \[function\] — .* · packages\/kit\/src\/lib\.rs:7 \[holds: again, process, program\]$/m);
    expect(out).toMatch(/^_reopen \[function\] — .* · packages\/kit\/kit\/restart\.py:4 \[holds: again, process, program\]$/m);
  });

  it('finds a declaration no file exports by words its name holds apart', async () => {
    checkout(DECLARED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'search', '--query', 'a child to spawn']);
    expect(out).toMatch(/^_spawn_child_process \[function\] — .* · packages\/kit\/kit\/restart\.py:8 \[holds: child, spawn\]$/m);
  });

  it('finds an export no manifest publishes, in TypeScript and Rust, by words its doc holds apart', async () => {
    checkout({
      'packages/kit/src/money/owners.ts': '/** The nearest named directory above a path. */\nexport function climb(path: string): string {\n  return path;\n}\n',
      'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n',
      'packages/kit/src/lib.rs': "/// Any path's package, tracked or not.\npub fn owner_of() {}\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const directory = await run(['ask', 'search', '--query', 'directory nearest a path']);
    expect(directory.out).toMatch(/^climb — @acme\/kit · packages\/kit\/src\/money\/owners\.ts:2 — The nearest named directory above a path\. \[holds: directory, nearest, path\]$/m);

    // `owner` is in the name, `tracked` and `path` in the doc.
    const tracked = await run(['ask', 'search', '--query', 'tracked path owner']);
    expect(tracked.out).toMatch(/^owner_of — .* · packages\/kit\/src\/lib\.rs:2 — Any path's package, tracked or not\. \[holds: owner, path, tracked\]$/m);
  });
});
