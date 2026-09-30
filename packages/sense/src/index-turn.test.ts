import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFailed, onTestFinished } from 'vitest';
import { inIndexTurn, indexTurnPath, type IndexTurnHolder } from './index-turn.js';

// Each test starts in a temporary directory of its own, which the suite's setup
// (`tools/temporary-per-test.ts`) makes, so the only turn a test here waits on
// is the one it took. The last test still moves to another one partway through:
// it has spoiled the turn's directory with a mode of 0o777, and needs a fresh
// temporary directory to plant a link where the turn's directory would be.
// `tmpdir()` reads TMPDIR on POSIX and TEMP, then TMP, on Windows.
const TEMPORARY = ['TMPDIR', 'TEMP', 'TMP'] as const;

function temporaryAt(directory: string): void {
  for (const name of TEMPORARY) process.env[name] = directory;
}
const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

describe('the index turn', () => {
  it('holds another checkout\'s index until the process holding the turn lets go, naming that process and its checkout', async () => {
    // The holder says so from inside its turn, and lets go on the first line it reads.
    const holder = spawn(process.execPath, ['--input-type=module', '-e', [
      "const { inIndexTurn } = await import('@variance-authority/sense');",
      "await inIndexTurn('/elsewhere', () => new Promise((resolve) => { process.stdout.write('held\\n'); process.stdin.once('data', resolve); }));",
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

    const ran = inIndexTurn('/here', async () => order.push('here'), (held) => {
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
    expect(told).toEqual([{ pid: holder.pid, root: '/elsewhere' }]);
    expect(order).toEqual(['told', 'here']);
  });

  it('is taken again once the work that held it is done, and let go when that work throws', async () => {
    await expect(inIndexTurn('/here', () => Promise.reject(new Error('refused')))).rejects.toThrow('refused');
    const told: IndexTurnHolder[] = [];
    expect(await inIndexTurn('/here', async () => 'ran', (held) => told.push(held))).toBe('ran');
    expect(told).toEqual([]);
  });

  // Windows has no owner, group and other bits, and a link needs a privilege there.
  it.skipIf(process.platform === 'win32')('keeps its directory to this user, and refuses one that is a link or others may write in rather than open the lock through it', async () => {
    expect(await inIndexTurn('/here', async () => 'ran')).toBe('ran');
    const directory = dirname(indexTurnPath());
    expect(statSync(directory).mode & 0o777).toBe(0o700);

    let ran = false;
    chmodSync(directory, 0o777);
    await expect(inIndexTurn('/here', async () => { ran = true; })).rejects.toThrow('alone may write in');

    temporaryAt(mkdtempSync(join(tmpdir(), 'va-index-turn-')));
    const elsewhere = join(tmpdir(), 'elsewhere');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, dirname(indexTurnPath()));
    await expect(inIndexTurn('/here', async () => { ran = true; })).rejects.toThrow('is not a directory this user owns');
    expect(ran).toBe(false);
  });
});
