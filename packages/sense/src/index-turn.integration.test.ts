import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, onTestFailed, onTestFinished, vi } from 'vitest';
import { inIndexTurn, indexTurnPath, type IndexTurnHolder } from './index-turn.js';
import { repositoryLayers } from './test-selection/cache-layers.js';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

/** A repository with one commit, in the spelling a process sees: the temporary directory is a symlink on macOS. */
function repository(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-index-turn-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', 'commit', '--quiet', '--allow-empty', '-m', 'the checkout'], { cwd: root });
  return root;
}

/** A worktree of `primary`, beside it. */
function worktreeOf(primary: string): string {
  const worktree = `${primary}-worktree`;
  execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'beside', worktree], { cwd: primary });
  return worktree;
}

describe('the index turn', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('holds a worktree\'s index until the process holding its primary checkout\'s turn lets go, naming that process and its checkout', async () => {
    const primary = repository();
    const worktree = worktreeOf(primary);
    // The holder says so from inside its turn, and lets go on the first line it reads.
    const holder = spawn(process.execPath, ['--input-type=module', '-e', [
      "const { inIndexTurn } = await import('@variance-authority/sense');",
      `await inIndexTurn(${JSON.stringify(primary)}, () => new Promise((resolve) => { process.stdout.write('held\\n'); process.stdin.once('data', resolve); }));`,
    ].join('\n')], { cwd: PACKAGE, env: process.env });
    let stderr = '';
    holder.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    onTestFailed(() => { console.error(`the holder's stderr:\n${stderr}`); });
    onTestFinished(() => { holder.kill(); });
    await new Promise<void>((resolve, reject) => {
      holder.stdout.once('data', () => resolve());
      holder.once('exit', (code) => reject(new Error(`the holder exited with ${code}: ${stderr}`)));
    });
    const told: IndexTurnHolder[] = [];
    const order: string[] = [];
    const release = (): void => { holder.stdin.write('\n'); };
    // Let go if nothing says it is waiting, so that silence fails the assertion
    // below rather than running into the test's timeout.
    const unheard = setTimeout(release, 2_000);
    onTestFinished(() => { clearTimeout(unheard); });

    const ran = inIndexTurn(worktree, async () => order.push('here'), (held) => {
      told.push(held);
      order.push('told');
      // Hold on for eight of the 25 ms pauses between tries, so a holder named
      // on every try would be named eight times.
      if (told.length === 1) {
        clearTimeout(unheard);
        setTimeout(release, 200);
      }
    });

    await ran;
    expect(told).toEqual([{ pid: holder.pid, root: primary }]);
    expect(order).toEqual(['told', 'here']);
  });

  it('is taken again once the work that held it is done, and let go when that work throws', async () => {
    const root = repository();
    await expect(inIndexTurn(root, () => Promise.reject(new Error('refused')))).rejects.toThrow('refused');
    const told: IndexTurnHolder[] = [];
    expect(await inIndexTurn(root, async () => 'ran', (held) => told.push(held))).toBe('ran');
    expect(told).toEqual([]);
  });

  it('is one file beside the worktrees\' layers in the repository\'s cache, whichever of its checkouts asks and from wherever inside one', () => {
    const primary = repository();
    const worktree = worktreeOf(primary);
    const inside = join(worktree, 'packages');
    mkdirSync(inside);

    const path = join(repositoryLayers(primary).base, '.work', 'index-turn');
    expect([indexTurnPath(primary), indexTurnPath(worktree), indexTurnPath(inside)]).toEqual([path, path, path]);
  });

  it('leaves another repository\'s index to run, even in one cache', async () => {
    const [one, other] = [repository(), repository()];
    expect(indexTurnPath(one)).not.toBe(indexTurnPath(other));
    expect(await inIndexTurn(one, () => inIndexTurn(other, async () => 'ran'))).toBe('ran');
  });

  it('writes nothing in the temporary directory, which everybody on the machine shares', async () => {
    const root = repository();
    const temporary = mkdtempSync(join(tmpdir(), 'va-index-turn-machine-'));
    vi.stubEnv('TMPDIR', temporary);

    await inIndexTurn(root, async () => 'ran');
    expect(readdirSync(temporary)).toEqual([]);
  });

  it('runs the work without the turn when the file system refuses it, and says so: the turn buys speed, and the work does not need it', async () => {
    const root = repository();
    const path = indexTurnPath(root);
    mkdirSync(path, { recursive: true });
    const refused: [string, string][] = [];

    expect(await inIndexTurn(root, async () => 'ran', () => {}, (at, reason) => refused.push([at, reason]))).toBe('ran');
    expect(refused).toEqual([[path, expect.any(String)]]);
  });
});
