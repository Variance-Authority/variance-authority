import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativeAvailable } from '../native.js';
import { runsAsBefore } from './runs-as-before.js';

/**
 * Which changed files run what they ran at a commit, read in a real checkout:
 * the text at the commit from git, the text now from the disk.
 */

const PRICE = 'export function price(total: number): number {\n  return total * 2;\n}\n';

function checkout(files: Readonly<Record<string, string>>): { root: string; commit: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-runs-as-before-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  write(root, files);
  git('add', '--all');
  git('commit', '--quiet', '--message', 'the merge base');
  return { root, commit: git('rev-parse', 'HEAD') };
}

function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
}

describe.runIf(nativeAvailable())('what each changed file moves for its importers', () => {
  it('names no export for an edit that was a comment, a type or formatting, and the export whose code moved', () => {
    const { root, commit } = checkout({
      'src/price.ts': PRICE,
      'src/typed.ts': PRICE,
      'src/moved.ts': PRICE,
      'src/style.css': '.a { color: red; }\n',
    });
    try {
      write(root, {
        'src/price.ts': `/** Doubles it. */\n${PRICE.replace('  return', '\n  return')}`,
        'src/typed.ts': PRICE.replaceAll('number', 'bigint'),
        'src/moved.ts': PRICE.replace('* 2', '* 3'),
        'src/style.css': '/* red */\n.a { color: red; }\n',
      });
      const answer = runsAsBefore(root, commit, ['src/moved.ts', 'src/price.ts', 'src/style.css', 'src/typed.ts']);
      expect(answer).toEqual({
        moved: new Map([['src/moved.ts', ['price']], ['src/price.ts', []], ['src/typed.ts', []]]),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('charges a file added or deleted since the commit whole, because one side has no text', () => {
    const { root, commit } = checkout({ 'src/price.ts': PRICE });
    try {
      rmSync(join(root, 'src/price.ts'));
      write(root, { 'src/added.ts': '// nothing yet\n' });
      expect(runsAsBefore(root, commit, ['src/added.ts', 'src/price.ts'])).toEqual({ moved: new Map() });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('charges a file that does not parse whole', () => {
    const { root, commit } = checkout({ 'src/price.ts': PRICE });
    try {
      write(root, { 'src/price.ts': `// half an edit\n${PRICE}export function (\n` });
      expect(runsAsBefore(root, commit, ['src/price.ts'])).toEqual({ moved: new Map() });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
