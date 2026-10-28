import { afterEach, describe, expect, it, vi } from 'vitest';

describe('what a case said, without the native addon', () => {
  afterEach(() => {
    vi.doUnmock('../addon.js');
    vi.resetModules();
  });

  const loaded = async (native: () => object | undefined) => {
    vi.resetModules();
    vi.doMock('../addon.js', () => ({
      native,
      nativeRefusal: () => (native() === undefined ? '@variance-authority/sense-linux-x64-gnu is not installed' : undefined),
    }));
    return import('./case-said.js');
  };

  it('refuses to resolve a row, naming why the addon did not load', async () => {
    const { saidRow } = await loaded(() => undefined);

    expect(() => saidRow('[]'))
      .toThrow('what a case said requires the Sense native addon: @variance-authority/sense-linux-x64-gnu is not installed');
  });

  it('refuses to resolve a row with an addon that has no resolver, naming the missing call', async () => {
    const { saidRow } = await loaded(() => ({}));

    expect(() => saidRow('[]'))
      .toThrow('what a case said requires the Sense native addon: the loaded addon has no `saidResolved`');
  });
});
