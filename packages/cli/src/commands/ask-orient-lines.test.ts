import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';

/**
 * `variance ask orient --files <path>:<line>`, through the command a person
 * types: each line is answered with the declarations it is in, from the parse
 * `variance index` published, with no recording.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-orient-lines-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

/** `files` written and committed in a new checkout, which is where the test now stands. */
function repository(files: Readonly<Record<string, string>>): string {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-orient-lines-')));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the checkout']);
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance ask orient at a line', () => {
  it('names the declarations each line asked about is in, with no recording, in TypeScript and in Rust', async () => {
    repository({
      'package.json': JSON.stringify({ name: 'shop', private: true }),
      'src/cart.ts': [
        'export interface Cart {',
        '  total: number;',
        '  add(item: string): void;',
        '}',
        '',
        'export const limit = {',
        '  items: 10,',
        '};',
        '',
        'export class Basket {',
        '  lines: string[] = [];',
        '  total(): number {',
        '    return this.lines.length;',
        '  }',
        '}',
        '',
        'function first(): number {',
        '  const inner = () => 1;',
        '  return inner();',
        '}',
        '',
        'function second(): number {',
        '  return limit.items + first();',
        '}',
        '',
      ].join('\n'),
      'src/total.rs': 'pub fn total() -> u32 {\n    1\n}\n\n#[cfg(test)]\nmod tests {\n    fn fixture() {\n        let _ = 1;\n    }\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const answered = await run(['ask', 'orient', '--files', 'src/cart.ts:2,src/cart.ts:4,src/cart.ts:7,src/cart.ts:13,src/cart.ts:21,src/total.rs:2,src/total.rs:8']);

    expect(answered.code).toBe(EXIT_CLEAN);
    const lines = answered.out.split('\n');
    expect(lines.slice(0, 9)).toEqual([
      '2 files asked about:',
      '  src/cart.ts:2   shop',
      '  src/cart.ts:4   shop',
      '  src/cart.ts:7   shop',
      '  src/cart.ts:13  shop',
      '  src/cart.ts:21  shop',
      '  src/total.rs:2  shop',
      '  src/total.rs:8  shop',
      '',
    ]);
    expect(lines.slice(9, 18)).toEqual([
      'Lines asked about, from the source index:',
      '  src/cart.ts:2   in interface Cart > property total (line 2)',
      '  src/cart.ts:4   in interface Cart (lines 1–4)',
      '  src/cart.ts:7   in const limit (lines 6–8)',
      '  src/cart.ts:13  in class Basket > method total (lines 12–14)',
      '  src/cart.ts:21  at the top level of the module',
      '  src/total.rs:2  in function total (lines 1–3)',
      '  src/total.rs:8  in module tests > function tests::fixture (lines 7–9)',
      '',
    ]);
  });

  it('names declarations that share a line side by side, says a Python class line may be in a member, and leaves a changed file\'s lines unanswered', async () => {
    const root = repository({
      'package.json': JSON.stringify({ name: 'shop', private: true }),
      'src/props.ts': 'interface Props { name: string; onClick(): void }\nexport function a() {} export function b() {}\n',
      'src/cart.py': 'class Cart:\n    def total(self):\n        return 1\n',
      'src/moved.ts': 'export function moved() {\n  return 1;\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(join(root, 'src/moved.ts'), '\n\nexport function moved() {\n  return 1;\n}\n');

    const answered = await run(['ask', 'orient', '--files', 'src/props.ts:1,src/props.ts:2,src/cart.py:3,src/moved.ts:4']);

    expect(answered.code).toBe(EXIT_CLEAN);
    const lines = answered.out.split('\n');
    const at = lines.indexOf('Lines asked about, from the source index:');
    expect(lines.slice(at, at + 6)).toEqual([
      'Lines asked about, from the source index:',
      '  src/props.ts:1  in interface Props > property name, method onClick (line 1)',
      '  src/props.ts:2  in function a, function b (line 2)',
      '  src/cart.py:3   in class Cart (lines 1–3); members are read from JavaScript and TypeScript only, so it may also be in a member of it',
      '  src/moved.ts:4  changed since the index parsed it, so its lines are not answered from that parse; `variance index` updates it',
      '',
    ]);
  });
});
