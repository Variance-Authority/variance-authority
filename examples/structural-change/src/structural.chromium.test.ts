import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDocket, diffSnapshots, normalize } from '@variance-authority/core';
import { createHarness } from '@variance-authority/playwright';
import { comparePngs } from '@variance-authority/png';

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VIEWPORT = { width: 320, height: 176, deviceScaleFactor: 1, colorScheme: 'light' } as const;

if (!BROWSER_AVAILABLE) {
  console.warn('\nexamples/structural-change: skipped.\n  no browser — npx playwright install chromium\n');
}

async function bundle(): Promise<string> {
  const result = await build({
    entryPoints: [join(HERE, 'page-agent.js')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error('esbuild produced no page-agent bundle');
  return output.text;
}

let result:
  | {
      readonly before: ReturnType<typeof normalize>;
      readonly after: ReturnType<typeof normalize>;
      readonly pixels: ReturnType<typeof comparePngs>;
      readonly docket: ReturnType<typeof buildDocket>;
    }
  | undefined;

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  const harness = await createHarness({
    url: pathToFileURL(join(ROOT, 'page', 'harness.html')).href,
    bundle: await bundle(),
    viewport: VIEWPORT,
    fonts: ['Arial/600/normal/system'],
    subjectId: () => 'component/account-card',
  });

  try {
    const before = normalize(await harness.capture('account-card', 'before'));
    const beforePng = await harness.page.locator('#frame').screenshot();
    const after = normalize(await harness.capture('account-card', 'after'));
    const afterPng = await harness.page.locator('#frame').screenshot();
    const diff = diffSnapshots(before, after);

    result = { before, after, pixels: comparePngs(beforePng, afterPng), docket: buildDocket([diff]) };
  } finally {
    await harness.close();
  }
}, 120_000);

afterAll(() => {
  result = undefined;
});

describe.skipIf(!BROWSER_AVAILABLE)('a structural change with no pixel delta', () => {
  it('keeps the screenshot identical', () => {
    expect(result!.pixels.dimensionsChanged).toBe(false);
    expect(result!.pixels.changed.default).toBe(0);
  });

  it('finds the changed document structure and accessible semantics', () => {
    expect(result!.before.structureHash).not.toBe(result!.after.structureHash);
    expect(result!.before.root.tag).toBe('div');
    expect(result!.before.root.role).toBeUndefined();
    expect(result!.before.root.name).toBeUndefined();
    expect(result!.after.root).toMatchObject({ tag: 'section', role: 'region', name: 'Account' });
  });

  it('attributes one structural finding to AccountCard', () => {
    expect(result!.docket.entries).toHaveLength(1);
    expect(result!.docket.entries[0]).toMatchObject({
      kind: 'component',
      label: 'AccountCard',
      structureIntact: false,
    });
  });
});
