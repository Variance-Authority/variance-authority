import { describe, expect, it } from 'vitest';
import { manifestMoved } from './index.js';

const BASE = {
  name: '@acme/ds',
  version: '1.0.0',
  type: 'module',
  exports: { '.': { import: './dist/index.js', require: './dist/index.cjs' } },
  scripts: { build: 'tsc' },
  dependencies: { lodash: '^4.17.21' },
};

const text = (manifest: object): string => `${JSON.stringify(manifest, null, 2)}\n`;

describe('whether a manifest moved what the install does not read', () => {
  it('moves on every field a resolver reads', () => {
    for (const [field, value] of [
      ['exports', { '.': './src/index.ts' }],
      ['imports', { '#x': './x.js' }],
      ['main', './dist/index.cjs'],
      ['module', './dist/index.mjs'],
      ['browser', './dist/browser.js'],
      ['type', 'commonjs'],
      ['sideEffects', false],
      ['name', '@acme/design'],
    ] as const) {
      expect(manifestMoved(text(BASE), text({ ...BASE, [field]: value })), field).toBe(true);
    }
  });

  it('moves when `exports` conditions are only reordered, because order is precedence', () => {
    const swapped = { ...BASE, exports: { '.': { require: './dist/index.cjs', import: './dist/index.js' } } };
    expect(manifestMoved(text(BASE), text(swapped))).toBe(true);
  });

  it('does not move on the fields the install comparison reads', () => {
    const bumped = { ...BASE, version: '1.1.0', dependencies: { lodash: '^4.17.22' }, resolutions: { a: '1' } };
    expect(manifestMoved(text(BASE), text(bumped))).toBe(false);
  });

  it('does not move on fields no module reads, or on formatting', () => {
    const described = { ...BASE, scripts: { build: 'tsc -b' }, description: 'buttons', keywords: ['ui'] };
    expect(manifestMoved(text(BASE), text(described))).toBe(false);
    expect(manifestMoved(text(BASE), JSON.stringify(BASE))).toBe(false);
  });

  it('moves on a field it does not know, since some tool reads it', () => {
    expect(manifestMoved(text(BASE), text({ ...BASE, jest: { testEnvironment: 'jsdom' } }))).toBe(true);
  });

  it('moves when either end is absent or unreadable', () => {
    expect(manifestMoved(undefined, text(BASE))).toBe(true);
    expect(manifestMoved(text(BASE), undefined)).toBe(true);
    expect(manifestMoved(text(BASE), '{ "name": ')).toBe(true);
  });
});
