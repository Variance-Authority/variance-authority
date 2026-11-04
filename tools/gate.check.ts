import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { unverified } from './gate.mjs';

const GATE = fileURLToPath(new URL('./gate.mjs', import.meta.url));

/**
 * The push gate asks about the refs git pushes, not the checkout: the tree each
 * pushed ref points to must carry both waves. A deletion and a tag are not asked.
 */
describe('unverified', () => {
  const trees: Record<string, string> = { a1: 'ta', b2: 'tb', c3: 'tc' };
  const stamped: Record<string, string[]> = { ta: ['near', 'rules'], tb: ['near'] };
  const check = (input: string) =>
    unverified(input, (sha: string) => trees[sha], (tree: string) => stamped[tree] ?? []).map(
      ({ ref, missing }: { ref: string; missing: string[] }) => [ref, missing],
    );

  it('passes a commit whose tree carries both waves', () => {
    expect(check('refs/heads/x a1 refs/heads/x 0000')).toEqual([]);
  });

  it('refuses each pushed ref by its own tree, whatever is checked out', () => {
    expect(check('refs/heads/x a1 refs/heads/x 0000\nrefs/heads/y b2 refs/heads/f 0000\nrefs/heads/z c3 refs/heads/z 0000')).toEqual([
      ['refs/heads/y', ['rules']],
      ['refs/heads/z', ['near', 'rules']],
    ]);
  });

  it('does not ask about a deletion or a tag', () => {
    expect(check('(delete) 0000000 refs/heads/x a1\nrefs/tags/v1 c3 refs/tags/v1 0000\n')).toEqual([]);
  });
});

/**
 * The gate in a real repository: the waves stamp a clean tree, and an agent's
 * push is judged by the tree each pushed ref points to, which is what CI tests
 * and the squash merge lands.
 */
describe('the gate in a git repository', () => {
  let repo: string;
  const run = (args: string[], input = '', env: NodeJS.ProcessEnv = {}) =>
    spawnSync('node', [GATE, ...args], { cwd: repo, input, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '', ...env } });
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const commit = (content: string) => {
    writeFileSync(join(repo, 'file'), content);
    git('add', 'file');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', content);
    return git('rev-parse', 'HEAD');
  };
  const push = (sha: string) => run(['pre-push'], `refs/heads/x ${sha} refs/heads/x ${'0'.repeat(40)}\n`, { CLAUDECODE: '1' });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'gate-'));
    git('init', '-q');
  });

  it('refuses to stamp a dirty tree, and the wave fails', () => {
    commit('a');
    writeFileSync(join(repo, 'file'), 'dirty');
    const result = run(['stamp', 'near']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/uncommitted changes/);
  });

  it('refuses an agent\'s push of an unstamped tip, and lets a person push it', () => {
    const sha = commit('a');
    run(['stamp', 'near']);
    expect(push(sha).status).toBe(1);
    expect(push(sha).stderr).toMatch(/no green rules wave/);
    expect(run(['pre-push'], `refs/heads/x ${sha} refs/heads/x ${'0'.repeat(40)}\n`).status).toBe(0);
  });

  it('passes a stamped tip over an unstamped commit before it', () => {
    commit('a');
    const tip = commit('b');
    expect(run(['stamp', 'near']).status).toBe(0);
    expect(run(['stamp', 'rules']).status).toBe(0);
    expect(push(tip).status).toBe(0);
  });
});
