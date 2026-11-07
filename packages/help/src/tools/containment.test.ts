import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { invocationOf } from '../ask.js';
import { containment, containmentOf, formatContainment } from './containment.js';

/** A workspace of no packages, and one source commit from each date. */
function dated(days: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'va-containment-tool-'));
  const git = (args: readonly string[], date?: string): void => {
    execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@acme.test', ...args], {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, ...(date === undefined ? {} : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) },
    });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  days.forEach((day, at) => {
    writeFileSync(join(root, 'a.ts'), `export const edit = ${String(at)};\n`);
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', `edit ${String(at)}`], `${day}T12:00:00Z`);
  });
  return root;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

describe('docs_containment', () => {
  it('reads a year back when no window is named', () => {
    const figures = containmentOf(dated([daysAgo(400), daysAgo(300)]), {});
    expect(figures.read).toBe(1);
  });

  it('answers over MCP in the words the verb prints', () => {
    const root = dated([daysAgo(3)]);
    const input = { after: daysAgo(10) };
    expect(containment.run(undefined, input, invocationOf({ root }))).toBe(formatContainment(containmentOf(root, input)));
  });

  it('refuses a host that named no checkout', () => {
    expect(() => containment.run(undefined, {}, invocationOf({}))).toThrow('this host named none');
  });
});
