import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inIndexTurn, type IndexTurnHolder } from './index-turn.js';

const machineTemporary = process.env['TMPDIR'];
const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

beforeEach(() => {
  process.env['TMPDIR'] = mkdtempSync(join(tmpdir(), 'va-index-turn-'));
});

afterEach(() => {
  if (machineTemporary === undefined) delete process.env['TMPDIR'];
  else process.env['TMPDIR'] = machineTemporary;
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
});
