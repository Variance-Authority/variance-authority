import { afterEach, describe, expect, it, vi } from 'vitest';
import { layReadings } from './case-readings.js';

describe('case readings without the native addon', () => {
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
    return import('./case-readings.js');
  };

  it('refuses to lay, naming why the addon did not load', async () => {
    const { layReadings: lay } = await loaded(() => undefined);

    expect(() => lay(undefined, undefined, undefined, new Set()))
      .toThrow('laying case readings requires the Sense native addon: @variance-authority/sense-linux-x64-gnu is not installed');
  });

  it('refuses to lay with an addon that has no lay, naming the missing call', async () => {
    const { layReadings: lay } = await loaded(() => ({}));

    expect(() => lay(undefined, undefined, undefined, new Set()))
      .toThrow('laying case readings requires the Sense native addon: the loaded addon has no `layReadings`');
  });

  it('refuses to read a case\'s readings, naming why the addon did not load', async () => {
    const { readingsOf } = await loaded(() => undefined);

    expect(() => readingsOf(new Uint8Array([0, 0]), undefined, 'a.test.ts > clicks'))
      .toThrow('reading case readings requires the Sense native addon: @variance-authority/sense-linux-x64-gnu is not installed');
  });
});
