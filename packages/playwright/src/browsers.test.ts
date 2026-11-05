import type { Browser } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leaseBrowser, ownBrowser } from './browsers.js';
import { ENGINE_TYPES } from './engines.js';

/**
 * The launch both leases go through, with Playwright's own stubbed.
 *
 * Each case carries launch options no other case uses, because the shelf keys a
 * shared browser by them and lives as long as this file.
 */

const OPENERS = [
  ['leaseBrowser', leaseBrowser],
  ['ownBrowser', ownBrowser],
] as const;

function launchFor(name: string): { readonly headless: boolean; readonly args: readonly string[] } {
  return { headless: true, args: [`--case=${name}`] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(OPENERS)('%s', (name, open) => {
  it('returns the browser a launch resolved to, and asks nothing before the launch', async () => {
    const browser = { on: vi.fn(), close: vi.fn(async () => {}) } as unknown as Browser;
    const launched = vi.spyOn(ENGINE_TYPES.chromium, 'launch').mockResolvedValue(browser);
    const located = vi.spyOn(ENGINE_TYPES.chromium, 'executablePath');

    const lease = await open('chromium', launchFor(`${name}-resolves`));

    expect(lease.value).toBe(browser);
    expect(launched).toHaveBeenCalledOnce();
    expect(located).not.toHaveBeenCalled();
    await lease.release();
  });

  it("says a launch that failed is the operator's, and keeps Playwright's reason and cause", async () => {
    const failure = new Error('browserType.launch: Executable does not exist');
    vi.spyOn(ENGINE_TYPES.chromium, 'launch').mockRejectedValue(failure);

    const error = await open('chromium', launchFor(`${name}-rejects`)).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toMatchObject({
      message: 'the browser did not start: browserType.launch: Executable does not exist',
      varianceOperatorError: true,
      cause: failure,
    });
  });
});
