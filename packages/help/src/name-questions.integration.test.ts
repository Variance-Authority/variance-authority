/// <depends path="../../../tools/name-questions.mjs" />
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `tools/name-questions.mjs`, the runner that asks a question set of a built
 * CLI and compares two runs, judging a change to how the name questions are
 * stored. An answer one build gives differently from one run to the next is
 * no answer to compare: the comparison names it and fails, whatever the other
 * side kept.
 */

const RUNNER = fileURLToPath(new URL('../../../tools/name-questions.mjs', import.meta.url));
const runner = (...args: string[]) => spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8' });

let at: string;
beforeEach(async () => { at = await mkdtemp(join(tmpdir(), 'name-questions-')); });
afterEach(async () => { await rm(at, { recursive: true, force: true }); });

describe('the name-question runner', () => {
  it('reports an answer that moved between runs of one build as not the same, kept or digested', async () => {
    // A build whose second answer differs from its first: it counts its calls in the workspace it is asked in.
    await mkdir(join(at, 'stable'));
    await mkdir(join(at, 'moving'));
    await writeFile(join(at, 'bin.mjs'), "import { existsSync, writeFileSync } from 'node:fs';\nconst again = existsSync('asked');\nwriteFileSync('asked', '');\nconsole.log(again ? 'second answer' : 'first answer');\n");
    await writeFile(join(at, 'set.queries'), 'packages\n');
    const asked = (workspace: string, runs: string) => runner('ask', join(at, 'set.queries'), '--workspace', join(at, workspace), '--out', join(at, `${workspace}.kept`), '--runs', runs, '--bin', join(at, 'bin.mjs'));
    expect(asked('stable', '1').status).toBe(0);
    expect(asked('moving', '2').status).toBe(0);
    await writeFile(join(at, 'moving.out'), runner('digest', join(at, 'moving.kept')).stdout);

    for (const candidate of ['moving.kept', 'moving.out']) {
      const compared = runner('compare', join(at, 'stable.kept'), join(at, candidate));
      expect(compared.stdout).toContain('000-packages.txt: answered otherwise by another run of the same build');
      expect(compared.stdout).toContain('0 of 1 answers the same');
      expect(compared.status).toBe(1);
    }
  });
});
