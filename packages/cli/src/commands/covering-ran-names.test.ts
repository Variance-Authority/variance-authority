import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HOUR, iso, oneRun, PAY, recordFixture } from './covering-record.fixture.js';

// `ci-info` decides CI once, when it loads, so the module is cut: these questions are asked outside CI.
const ci = vi.hoisted(() => ({ isCI: false }));
vi.mock('ci-info', () => ({ get isCI() { return ci.isCI; } }));
// Cut so a test can refuse the update as a full disk would, whoever runs the suite: a directory's mode does not stop root.
const update = vi.hoisted(() => ({ fails: undefined as string | undefined }));
vi.mock('@variance-authority/sense', async (importOriginal) => {
  const original = await importOriginal<typeof import('@variance-authority/sense')>();
  const updateSourceIndex: typeof original.updateSourceIndex = (...args) =>
    update.fails === undefined ? original.updateSourceIndex(...args) : Promise.reject(new Error(update.fails));
  return { ...original, updateSourceIndex };
});

/**
 * `covering` names the text it holds by the source index's name for it, as
 * `coverage` does: outside CI it brings the index up to the checkout first,
 * and when that fails which text ran is not known, with the reason.
 */

const { checkout, ask } = recordFixture();

describe('a covering answer names the held text by the source index', () => {
  it('says which text ran is not known when the source index cannot be brought up to the checkout', async () => {
    const { at } = await checkout({ runs: (_, recorded) => ({ commit: recorded, ...oneRun(iso(Date.now() - HOUR), ['src/pay.test.ts']) }) });
    // An edit the index has not read, so bringing it up to the checkout has something to write.
    await writeFile(join(at, 'src/pay.ts'), `${PAY}export const fee = 0;\n`);
    update.fails = 'ENOSPC: no space left on device, write';
    try {
      const { json } = await ask(at, '--file', 'src/pay.ts');

      expect(json).toMatchObject({ ran: { stands: [{ tests: ['src/pay.test.ts'] }] } });
      const [stand] = (json['ran'] as { stands: { text?: string; unknown?: string }[] }).stands;
      expect(stand!.text).toBeUndefined();
      expect(stand!.unknown).toMatch(/^which text ran is not known: the source index at .+ could not be updated to the checkout: .*no space left on device/u);
    } finally {
      update.fails = undefined;
    }
  });
});
