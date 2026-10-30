import { chmod, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { sourceIndexPath } from '@variance-authority/sense';
import { HOUR, iso, oneRun, PAY, recordFixture } from './covering-record.fixture.js';

// `ci-info` decides CI once, when it loads, so the module is cut: these questions are asked outside CI.
const ci = vi.hoisted(() => ({ isCI: false }));
vi.mock('ci-info', () => ({ get isCI() { return ci.isCI; } }));

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
    const index = dirname(sourceIndexPath(at));
    await chmod(index, 0o555);
    try {
      const { json } = await ask(at, '--file', 'src/pay.ts');

      expect(json).toMatchObject({ ran: { stands: [{ tests: ['src/pay.test.ts'] }] } });
      const [stand] = (json['ran'] as { stands: { text?: string; unknown?: string }[] }).stands;
      expect(stand!.text).toBeUndefined();
      expect(stand!.unknown).toMatch(/^which text ran is not known: the source index at .+ could not be updated to the checkout: .*Permission denied/u);
    } finally {
      await chmod(index, 0o755);
    }
  });
});
