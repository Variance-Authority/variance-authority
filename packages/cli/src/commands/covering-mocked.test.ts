import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { reachOf, regionRecord } from '@variance-authority/sense/test-selection';
import { covering } from './covering.js';
import { indexOutput } from './index-command.js';

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

/**
 * A mock's own evaluation of the real module is not a case reaching it, so
 * every covering answer reads the file graph that says who mocked what, even
 * when the record marks load time only on that crossing.
 */
describe('asking about a region only a mock evaluated', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  async function checkout(): Promise<{ root: string; execution: string }> {
    const root = await mkdtemp(join(tmpdir(), 'variance-covering-mocked-'));
    const git = (args: readonly string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    };
    await mkdir(join(root, 'src'), { recursive: true });
    git(['init', '--quiet', '--initial-branch', 'main']);
    git(['config', 'user.email', 'fixture@example.test']);
    git(['config', 'user.name', 'Fixture']);
    const body = Array.from({ length: 6 }, (_, at) => `export const line${at + 1} = ${at + 1};`).join('\n');
    await writeFile(join(root, 'src/total.ts'), `${body}\n`);
    await writeFile(
      join(root, 'mocked.test.ts'),
      "import { vi } from 'vitest';\nimport { line1 } from './src/total';\nvi.mock('./src/total');\nit('stubs', () => line1);\n",
    );
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'first']);
    process.chdir(root);

    const dir = await mkdtemp(join(tmpdir(), 'variance-covering-'));
    const execution = join(dir, 'cases.json');
    await writeFile(execution, JSON.stringify({
      tests: [{ id: 'stub', file: 'mocked.test.ts', name: 'stubs', stopped: false }],
      modules: [{
        file: 'src/total.ts',
        blocks: [
          { kind: 'statement', name: 'line3', path: 'statement#2', startLine: 3, endLine: 3, source: true, crossings: [{ test: 0, distance: 0, loaded: true }] },
        ],
      }],
    }));
    return { root, execution };
  }

  it('reads it unwalked on the whole file, a line and a change alike', async () => {
    const { root, execution } = await checkout();
    await indexOutput({ cwd: root });
    const asked = (...flags: string[]) => covering(parse([...flags, '--root', root, '--execution', execution]));
    const [line, whole] = [await asked('--file', 'src/total.ts', '--line', '3'), await asked('--file', 'src/total.ts')];
    const range = whole.ranges?.find((one) => one.startLine === 3);

    expect([line.state, range === undefined ? undefined : reachOf(range)]).toEqual(['unwalked', 'unwalked']);
    expect(line.tests).toEqual([]);

    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'base'], { cwd: root, stdio: 'pipe' });
    await writeFile(join(root, 'src/total.ts'), (await readFile(join(root, 'src/total.ts'), 'utf8')).replace('= 3;', '= 3; // edited'));
    const change = await asked('--since', 'HEAD');
    const region = change.changed?.[0]?.regions[0];
    expect(region === undefined ? undefined : reachOf(regionRecord(region))).toBe('unwalked');
  });
});
