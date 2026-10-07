import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeSuiteIndex } from '@variance-authority/report/suite-index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from './bin.js';
import { EXIT_CLEAN } from './exit.js';

/**
 * `variance collect` and `variance collect merge` as a person types them:
 * through `main`, from a config and a collector module on disk, so the claim is
 * about the binary's routing and exit code rather than about the handlers.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-collect-main-'));
  await writeFile(
    join(root, 'variance.config.json'),
    JSON.stringify({
      project: 'collect',
      profile: 'chromium',
      viewport: { width: 1280, height: 800 },
      retention: 'ephemeral',
      subjects: { kind: 'list', ids: ['cart/empty', 'cart/full', 'checkout/paid'], collector: './collector.mjs' },
      fonts: [],
      report: '.variance/report.json',
    }),
  );
  // A collector that renders each subject and reads nothing from it: the routing
  // is under test, not the reading.
  await writeFile(
    join(root, 'collector.mjs'),
    'export default ({ plan }) => ({\n' +
      '  plan: async () => plan,\n' +
      '  collect: async () => ({ ok: true, document: {} }),\n' +
      '  close: async () => {},\n' +
      '});\n',
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function variance(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

describe('variance collect, through the binary', () => {
  it('collects each shard into a part, and merges the parts into the suite index', async () => {
    const config = join(root, 'variance.config.json');
    const parts = [join(root, 'evidence-1.json'), join(root, 'evidence-2.json')];

    for (const [i, part] of parts.entries()) {
      const collected = await variance('collect', '--config', config, '--shard', `${String(i + 1)}/2`, '--out', part);
      expect(collected.code, collected.err).toBe(EXIT_CLEAN);
    }
    const index = join(root, 'suite.index');
    const merged = await variance('collect', 'merge', ...parts, '--out', index);

    expect(merged.code, merged.err).toBe(EXIT_CLEAN);
    expect(merged.out).toMatch(/from 2 parts/);
    expect(decodeSuiteIndex(await readFile(index)).coverage?.map((entry) => entry.subject)).toEqual(['cart/empty', 'cart/full', 'checkout/paid']);
  });
});
