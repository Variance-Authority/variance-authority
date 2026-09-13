import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as root from './index.js';
import * as archive from './archive.js';
import * as collect from './collect.js';
import * as playwright from './playwright.js';
import * as rtl from './rtl.js';

describe('Eyes entrypoints', () => {
  it('keeps both host stacks optional and out of shipped dependencies', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional?: boolean }>;
    };

    expect(Object.keys(manifest.dependencies)).toEqual([
      '@variance-authority/core',
      '@variance-authority/react',
    ]);
    expect(manifest.peerDependenciesMeta).toMatchObject({
      '@playwright/test': { optional: true },
      '@testing-library/dom': { optional: true },
      '@testing-library/react': { optional: true },
    });
  });

  it('keeps optional hosts out of the root entrypoint', () => {
    expect(root.snapshotNode).toBeTypeOf('function');
    expect(root.createEyesLog).toBeTypeOf('function');
    expect(root.createEyesArchive).toBeTypeOf('function');
    expect(archive.readEyesArchive).toBeTypeOf('function');
    expect(root.eyesTestAttention).toBeTypeOf('function');
    expect(root).not.toHaveProperty('watch');
    expect(root).not.toHaveProperty('eyesFixtures');
  });

  it('keeps the run-writing half in its own entrypoint', () => {
    // `./rtl` is imported by a test file, which a bundler may follow into a
    // browser. Journal writing is `node:fs` and belongs where a runner reaches
    // it and a page never does.
    expect(collect.recordEyesTest).toBeTypeOf('function');
    expect(collect.resetEyesJournals).toBeTypeOf('function');
    expect(collect.gatherEyesArchive).toBeTypeOf('function');
    expect(collect.writeEyesArchive).toBeTypeOf('function');
    expect(collect.EYES_JOURNAL_SUFFIX).toBe('.va-eyes.json');
    expect(rtl.watchTest).toBeTypeOf('function');
    expect(rtl).not.toHaveProperty('recordEyesTest');
    expect(root).not.toHaveProperty('recordEyesTest');
  });

  it('exports an additive RTL mutation and unbound Playwright fixture parts', () => {
    expect(rtl.watch).toBeTypeOf('function');
    expect(playwright.eyesFixtures).toBeTypeOf('object');
    expect(playwright.bundleEyesAgent).toBeTypeOf('function');
    expect(playwright).not.toHaveProperty('test');
    expect(playwright).not.toHaveProperty('expect');
  });

  it('publishes the page agent built from the same source', async () => {
    const bundle = await playwright.bundleEyesAgent();
    expect(bundle).toContain(JSON.stringify(playwright.EYES_AGENT));
    expect(bundle).toContain(JSON.stringify(playwright.EYES_AGENT_VERSION));
  });
});
