import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, paragraph, run } from './ask-packages-fixture.js';

/**
 * `variance ask symbol` about a name the workspace declares as a member of a
 * type. A member is the workspace's own declaration whether or not another file
 * declares a top-level name that shares its spelling, and whatever language
 * declares it: a method in a Rust `impl`, a Java field. Either was answered with
 * *no file declares it*, or left out behind a top-level namesake.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-members-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const NAMESAKES = {
  'packages/kit/src/money/restart.ts': [
    'export const restart = (argv: readonly string[]): number => relaunch(argv);',
    '',
    'function relaunch(argv: readonly string[]): number {',
    '  return argv.length;',
    '}',
    '',
  ].join('\n'),
  'packages/kit/src/money/table.ts': [
    'export class Table {',
    '  private readonly relaunch = new Map<string, number>();',
    '  restart(): number {',
    '    return this.relaunch.size;',
    '  }',
    '}',
    '',
  ].join('\n'),
};

const RUST = {
  'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n',
  'packages/kit/src/lib.rs': [
    'pub struct Bound {',
    '    pub width: u32,',
    '}',
    '',
    'impl Bound {',
    '    fn same_bound(&self, other: &Self) -> bool {',
    '        self.width == other.width',
    '    }',
    '}',
    '',
    'pub trait Charged {',
    '    fn charge_once(&mut self) -> u32;',
    '}',
    '',
  ].join('\n'),
};

const JAVA = {
  'packages/kit/src/dev/kit/Agent.java': [
    'package dev.kit;',
    '',
    'public final class Agent {',
    '  private final int retained = 0;',
    '',
    '  public void premainOnce(String args) {}',
    '}',
    '',
  ].join('\n'),
};

describe('variance ask symbol about a member', () => {
  it('answers a class member beside a top-level declaration of the same name', async () => {
    checkout(NAMESAKES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'relaunch']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(paragraph(out, /^relaunch \[function\]\n/)).toContain('declared, not exported, at packages/kit/src/money/restart.ts:3 by @acme/kit');
    const member = paragraph(out, /^relaunch\na member of `Table`/);
    expect(member).toContain('a member of `Table`, declared at packages/kit/src/money/table.ts:2 by @acme/kit');
    expect(member).toContain('private readonly relaunch = new Map<string, number>();');
  });

  it('answers a class member beside the published name it shares', async () => {
    checkout(NAMESAKES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'restart']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('a member of `Table`, declared at packages/kit/src/money/table.ts:3 by @acme/kit');
  });

  it('answers a method of a Rust `impl`, a trait method and a struct field on the type that holds them', async () => {
    checkout(RUST);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const [name, on, line] of [['same_bound', 'Bound', 6], ['charge_once', 'Charged', 12], ['width', 'Bound', 2]] as const) {
      const { code, out, err } = await run(['ask', 'symbol', '--name', name]);
      expect(err).toBe('');
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toContain(`a member of \`${on}\`, declared at packages/kit/src/lib.rs:${line}`);
      expect(out).not.toContain('No file in this workspace');
      expect(out).toContain('docs_uses names the search that finds the lines that use it, as text: no reader of this file records them.');
    }
  });

  it('answers a method and a field of a Java class', async () => {
    checkout(JAVA);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const [name, line] of [['premainOnce', 6], ['retained', 4]] as const) {
      const { code, out, err } = await run(['ask', 'symbol', '--name', name]);
      expect(err).toBe('');
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toContain(`a member of \`Agent\`, declared at packages/kit/src/dev/kit/Agent.java:${line}`);
    }
  });
});
