import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_OPERATOR } from '../exit.js';

/** `variance ask journey-map`, through the command a person types: it refuses by naming what is missing. */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-journey-map-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

function checkout(): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-journey-map-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
}

async function run(argv: readonly string[]): Promise<{ code: number; err: string }> {
  let err = '';
  const code = await main(argv, { out: () => undefined, err: (text) => { err += text; } });
  return { code, err };
}

describe('variance ask journey-map', () => {
  it('asks for the file when none is named', async () => {
    checkout();
    const answered = await run(['ask', 'journey-map']);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('--file');
  });

  it('says the checkout has no recording to read when nothing was recorded', async () => {
    checkout();
    const answered = await run(['ask', 'journey-map', '--file', 'src/a.ts', '--query', 'pay']);
    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err).toContain('holds no suite to read');
  });
});
