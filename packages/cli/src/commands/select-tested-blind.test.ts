import { describe, expect, it } from 'vitest';
import { OTHER, TOTAL, queued, scratch, selected } from './select-tested.fixture.js';

/**
 * `variance select --ran-at` where HEAD's import graph cannot say what a
 * side's change reaches: a test it may reach runs, as it does without
 * `--ran-at`.
 */

const home = scratch();
const RATE = 'export const rate = 1;\nexport const name = "rate";\nexport const unit = "eur";\n';

describe('`variance select --ran-at` where the graph is blind', () => {
  it('selects as without `--ran-at` when the pull request imports a module the mainline deletes', async () => {
    const UTIL = 'export const rate = 0.9;\n';
    const queue = await queued(home(), {
      start: { 'src/util.ts': UTIL, 'src/total.ts': "import { rate } from './util';\n" + TOTAL.replace('0.9', 'rate') },
      entered: { 'src/util.ts': 'test/total.test.ts' },
      base: { 'src/total.ts': TOTAL, 'src/util.ts': null },
      prs: [{ 'src/other.ts': "import { rate } from './util';\n" + OTHER.replace('+ 1', '+ rate') }],
      recordAt: 'fork',
    });

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // `other` imports a file HEAD no longer holds: it fails on the merge, and on neither side.
    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--ran-at ${queue.tested}\` selects as without it: read alone, the pull request's change selects every test file (it reaches src/other.ts, whose imports the graph could not all read)`);
  });

  it('selects as without `--ran-at` when the pull request loads a module the mainline changed by a name it builds', async () => {
    const DYNAMIC = "export async function other(price: number): Promise<number> {\n  const name = './' + 'rate';\n  const { rate } = await import(name);\n  return price + rate;\n}\n";
    const queue = await queued(home(), {
      start: { 'src/rate.ts': 'export const rate = 1;\n', 'src/total.ts': "import { rate } from './rate';\n" + TOTAL.replace('0.9', 'rate') },
      entered: { 'src/rate.ts': 'test/total.test.ts' },
      base: { 'src/rate.ts': 'export const rate = 5;\n' },
      prs: [{ 'src/other.ts': DYNAMIC }],
      recordAt: 'fork',
    });

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // Nothing in HEAD's graph says `other` loads `rate`, which the mainline changed.
    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--ran-at ${queue.tested}\` selects as without it: read alone, the pull request's change selects every test file (it reaches src/other.ts, whose imports the graph could not all read)`);
  });

  it('selects as without `--ran-at` when the mainline changes a runner config no `before` declares', async () => {
    const queue = await queued(home(), {
      start: { 'vitest.config.ts': 'export default {};\n' },
      base: { 'vitest.config.ts': 'export default { test: { globals: true } };\n' },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
    });

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // `other` ran at the tested tree on the config the mainline has since changed.
    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--ran-at ${queue.tested}\` selects as without it: read alone, the mainline's change selects every test file (nothing says which test vitest.config.ts reaches)`);
  });

  it('selects as without `--ran-at` when the pull request renames a module the mainline changes', async () => {
    const queue = await queued(home(), {
      start: { 'src/rate.ts': RATE, 'src/total.ts': "import { rate } from './rate';\n" + TOTAL.replace('0.9', 'rate') },
      entered: { 'src/rate.ts': 'test/total.test.ts' },
      base: { 'src/rate.ts': RATE.replace('rate = 1', 'rate = 5') },
      prs: [{
        'src/rate.ts': null, 'src/price-rate.ts': RATE,
        'src/total.ts': "import { rate } from './price-rate';\n" + TOTAL.replace('0.9', 'rate'),
        'src/other.ts': "import { rate } from './price-rate';\n" + OTHER.replace('+ 1', '+ rate'),
      }],
      recordAt: 'fork',
    });

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // git carries the mainline's `rate = 5` into `price-rate.ts`, which `other` imports.
    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--ran-at ${queue.tested}\` selects as without it: read alone, the mainline's change selects every test file (the merge holds its change to src/rate.ts under another path)`);
  });

  it('selects as without `--ran-at` when the mainline renames a module the pull request changes', async () => {
    const queue = await queued(home(), {
      start: { 'src/rate.ts': RATE, 'src/total.ts': "import { rate } from './rate';\n" + TOTAL.replace('0.9', 'rate') },
      entered: { 'src/rate.ts': 'test/total.test.ts' },
      base: {
        'src/rate.ts': null, 'src/price-rate.ts': RATE,
        'src/total.ts': "import { rate } from './price-rate';\n" + TOTAL.replace('0.9', 'rate'),
        'src/other.ts': "import { rate } from './price-rate';\n" + OTHER.replace('+ 1', '+ rate'),
      },
      prs: [{ 'src/rate.ts': RATE.replace('rate = 1', 'rate = 5') }],
      recordAt: 'fork',
    });

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // git carries the pull request's `rate = 5` into `price-rate.ts`, which the mainline's `other` imports.
    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--ran-at ${queue.tested}\` selects as without it: read alone, the pull request's change selects every test file (the merge holds its change to src/rate.ts under another path)`);
  });
  it('runs a test the record says executed a module the pull request makes import what the mainline changed', async () => {
    const LOADED = "it('others', async () => {\n  const name = '../src/' + 'other';\n  const { other } = await import(name);\n  other(1);\n});\n";
    const queue = await queued(home(), {
      start: { 'test/other.test.ts': LOADED },
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': "import { total } from './total';\n" + OTHER.replace('+ 1', '+ total(1)') }],
      recordAt: 'fork',
    });

    const here = await selected(queue.dir, queue.base, queue.tested);

    // HEAD's graph stops at `other`, which `other.test` loads by a name it builds; the record says it ran `other`.
    expect(here.out).toBe('test/total.test.ts\n');
  });
  it('selects as without `--ran-at` when a side reaches a module the record never saw run, which no recorded test imports', async () => {
    const LOADS = "it('others', async () => {\n  const prefix = '../src/';\n  const { other } = await import(prefix + 'other');\n  if (other(1) === 3) {\n    const { check } = await import(prefix + 'latent');\n    check();\n  }\n});\n";
    const queue = await queued(home(), {
      start: { 'test/other.test.ts': LOADS, 'src/latent.ts': "import { total } from './total';\nexport function check(): void {\n  if (total(100) !== 90) throw new Error('the merge broke it');\n}\n" },
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': OTHER.replace('+ 1', '+ 2') }],
      recordAt: 'fork',
    });

    const whole = await selected(queue.dir, queue.base);
    const here = await selected(queue.dir, queue.base, queue.tested);

    // The run that made the record never loaded `latent`, and nothing in HEAD's graph says which test does.
    expect(here.out).toBe(whole.out);
    expect(here.err).toContain(`\`--ran-at ${queue.tested}\` selects as without it: read alone, the mainline's change selects every test file (nothing says which test src/latent.ts reaches)`);
  });
});
