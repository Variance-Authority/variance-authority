import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeTestCoverage, testCoverageFile } from '@variance-authority/sense/test-selection';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/** `variance trace` through `main`: what stdout holds for a viewer, and what a run with no clock says on stderr. */

const cwd = process.cwd();
let root: string;

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-trace-cli-cache-')));
  root = mkdtempSync(join(tmpdir(), 'va-trace-cli-'));
  execFileSync('git', ['init', '--quiet', root]);
  process.chdir(root);
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

function record(tests: Parameters<typeof encodeTestCoverage>[0]['tests']): void {
  const at = testCoverageFile(root);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, encodeTestCoverage({ version: 3, instrumentation: 'fixture', tests, modules: [] }));
}

async function trace(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(['trace', ...argv], { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

describe('variance trace', () => {
  it('prints OTLP/JSON with a run span over each file that has a start', async () => {
    record([
      { file: 'e2e/a.spec.ts', complete: true, preconditions: [], duration: 900, start: 1_800_000_001_250 },
      { file: 'test/b.test.ts', complete: true, preconditions: [], duration: 20 },
    ]);

    const said = await trace(['--format', 'otlp']);

    expect(said.code).toBe(EXIT_CLEAN);
    const spans = JSON.parse(said.out).resourceSpans[0].scopeSpans[0].spans as { name: string }[];
    expect(spans.map((span) => span.name)).toEqual(['run', 'e2e/a.spec.ts']);
    expect(said.err).toBe('');
  });

  it('says on stderr that no span was placed when no file has a start', async () => {
    record([{ file: 'test/b.test.ts', complete: true, preconditions: [], duration: 20 }]);

    const said = await trace([]);

    expect(said.code).toBe(EXIT_CLEAN);
    expect(JSON.parse(said.out).resourceSpans[0].scopeSpans[0].spans).toEqual([]);
    expect(said.err).toMatch(/no file in .* has a start offset/u);
  });

  it('refuses a format it does not print, and a recording it cannot find', async () => {
    expect((await trace(['--format', 'json'])).code).toBe(EXIT_OPERATOR);
    expect((await trace([])).code).toBe(EXIT_OPERATOR);
  });
});
