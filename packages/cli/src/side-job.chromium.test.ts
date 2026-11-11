import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import './bin.fixture.js';
import { main } from './bin.js';
import { EXIT_REVIEW } from './exit.js';

/**
 * `variance run --exit-zero-on-changes` over a subject it could not observe.
 *
 * The flag maps a change to 0 and nothing else: a run that could not observe a
 * subject did not report on it, and its check stays red. A browser, because
 * `run` opens one before it collects.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/cli run --exit-zero-on-changes: skipped.' + '\n  no browser — npx playwright install chromium\n',
  );
}

describe.skipIf(!BROWSER_AVAILABLE)('`variance run --exit-zero-on-changes`', () => {
  it('keeps exit 1 over a subject the run could not observe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-side-job-run-'));
    await writeFile(
      join(root, 'variance.config.json'),
      JSON.stringify({
        project: 'side-job',
        profile: 'chromium',
        viewport: { width: 320, height: 240 },
        retention: 'ephemeral',
        subjects: { kind: 'list', ids: ['fixture:a'], collector: './collector.mjs' },
        fonts: [],
        report: 'report.json',
      }),
      'utf8',
    );
    await writeFile(
      join(root, 'collector.mjs'),
      "export default ({ plan }) => ({ plan: async () => plan, collect: async () => ({ ok: false, because: 'the server died' }), close: async () => {} });\n",
      'utf8',
    );

    let err = '';
    const code = await main(['run', '--config', join(root, 'variance.config.json'), '--exit-zero-on-changes'], {
      out: () => undefined,
      err: (text) => {
        err += text;
      },
    });

    expect(code).toBe(EXIT_REVIEW);
    expect(err).toContain('a subject could not be observed');
    expect(err).not.toContain('changes need review');
  });
});
