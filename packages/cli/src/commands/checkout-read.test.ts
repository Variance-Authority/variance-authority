import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkoutRead } from './checkout-read.js';

async function repository(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'variance-checkout-read-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'root');
  return dir;
}

/** A state per run, each at its own commit and tree, the latest landing last. */
const states = (count: number) => Array.from({ length: count }, (_, at) => ({
  commit: `${String(at).padStart(2, '0')}`.repeat(20),
  tree: `${String(at).padStart(2, '0')}`.repeat(20),
  files: [`t${String(at)}.test.ts`],
}));

describe('the note on a record this checkout ran over many states', () => {
  it('names the latest state and counts the earlier ones, however many runs landed', async () => {
    const dir = await repository();
    const many = await checkoutRead('unit', dir, { layer: { ran: states(40) } });
    const few = await checkoutRead('unit', dir, { layer: { ran: states(2) } });

    expect(many).toContain('40 test file(s) ran here, every other is the mainline\'s: t39.test.ts at 393939393939 with uncommitted edits (tree 393939393939)');
    expect(many).toContain('; and 39 test file(s) over 39 earlier state(s)');
    expect(many).not.toContain('t0.test.ts');
    expect(many.length - few.length).toBeLessThan(10);
  });

  it('counts a test file that ran in several earlier states once', async () => {
    const same = states(4).map((state) => ({ ...state, files: ['t.test.ts'] }));
    const said = await checkoutRead('unit', await repository(), { layer: { ran: same } });

    expect(said).toContain('; and 1 test file(s) over 3 earlier state(s)');
  });
});
