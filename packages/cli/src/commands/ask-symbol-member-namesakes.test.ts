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
 * declares it: a Java field, a method of a Python class. Either was answered with
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

const PYTHON = {
  'packages/kit/kit/bound.py': [
    'class Bound:',
    '    width = 0',
    '',
    '    def same_bound(self, other):',
    '        return self.width == other.width',
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

  it('answers a method and an attribute of a Python class on the class that holds them', async () => {
    checkout(PYTHON);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const [name, line] of [['same_bound', 4], ['width', 2]] as const) {
      const { code, out, err } = await run(['ask', 'symbol', '--name', name]);
      expect(err).toBe('');
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toContain(`a member of \`Bound\`, declared at packages/kit/kit/bound.py:${line}`);
      expect(out).not.toContain('No file in this workspace');
      expect(out).toContain('docs_uses names the search that finds the lines that use it, as text: no reader of this file records them.');
    }
  });

  it('answers the first five member declarations and counts the rest', async () => {
    checkout({ 'packages/kit/kit/sizes.py': ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((on) => `class ${on}:\n    size = 0\n`).join('\n') });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'size']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out.match(/^a member of `/gmu)).toHaveLength(5);
    expect(out).toContain('a member of `Five`, declared at packages/kit/kit/sizes.py:14');
    expect(out).not.toContain('a member of `Six`');
    expect(out).toContain('1 more member declaration of `size` not shown; docs_uses lists more, and its `package` narrows them to one package.');
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
