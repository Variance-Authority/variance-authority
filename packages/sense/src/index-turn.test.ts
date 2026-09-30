import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inIndexTurn, indexTurnPath, type IndexTurnHolder } from './index-turn.js';

// `tmpdir()` reads TMPDIR on POSIX and TEMP, then TMP, on Windows.
const TEMPORARY = ['TMPDIR', 'TEMP', 'TMP'] as const;
const machineTemporary = TEMPORARY.map((name) => process.env[name]);

function temporaryAt(directory: string): void {
  for (const name of TEMPORARY) process.env[name] = directory;
}
const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

beforeEach(() => {
  temporaryAt(mkdtempSync(join(tmpdir(), 'va-index-turn-')));
});

afterEach(() => {
  TEMPORARY.forEach((name, at) => {
    const value = machineTemporary[at];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
});

describe('the index turn', () => {
  it('holds another checkout\'s index until the process holding the turn lets go, naming that process and its checkout', async () => {
    // The holder says so from inside its turn, and lets go on the first line it reads.
    const holder = spawn(process.execPath, ['--input-type=module', '-e', [
      "const { inIndexTurn } = await import('@variance-authority/sense');",
      "await inIndexTurn('/elsewhere', () => new Promise((resolve) => { process.stdout.write('held\\n'); process.stdin.once('data', resolve); }));",
    ].join('\n')], { cwd: PACKAGE, env: process.env });
    await new Promise<void>((resolve, reject) => {
      holder.stdout.once('data', () => resolve());
      holder.once('exit', (code) => reject(new Error(`the holder exited with ${code}`)));
    });
    const told: IndexTurnHolder[] = [];
    const order: string[] = [];

    const ran = inIndexTurn('/here', async () => order.push('here'), (held) => {
      told.push(held);
      order.push('told');
      holder.stdin.write('\n');
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
