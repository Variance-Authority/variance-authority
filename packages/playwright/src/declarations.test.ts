import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { createDeclarationReader } from './declarations.js';

/**
 * The engine that declines. WebKit and Firefox have no CDP session to give, and
 * a run there must read exactly as a run whose page met no components: an
 * empty index, no exception, and the scan left standing underneath.
 */
function decliningPage(names: readonly string[]): Page {
  return {
    evaluate: async () => ({ id: 'g1', names: [...names] }),
    context: () => ({
      newCDPSession: async () => {
        throw new Error('Protocol error: CDP is only available in Chromium');
      },
    }),
  } as unknown as Page;
}

describe('the declaration reader without CDP', () => {
  it('answers the empty index and asks nothing', async () => {
    const reader = createDeclarationReader(decliningPage(['Button']));
    expect(await reader.read()).toEqual({});
    expect(await reader.read()).toEqual({});
    expect(reader.stats).toEqual({ asked: 0, located: 0 });
    await reader.close();
  });

  it('answers the empty index when the page cannot be evaluated', async () => {
    const page = {
      evaluate: async () => {
        throw new Error('Execution context was destroyed');
      },
    } as unknown as Page;
    const reader = createDeclarationReader(page);
    expect(await reader.read()).toEqual({});
    await reader.close();
  });
});
