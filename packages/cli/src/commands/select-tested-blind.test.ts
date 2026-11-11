import { describe, expect, it } from 'vitest';
import { OTHER, TOTAL, queued, scratch, selected } from './select-tested.fixture.js';

/**
 * `variance select --tested` where HEAD's import graph cannot say what a
 * side's change reaches: a test it may reach runs, as it does without
 * `--tested`.
 */

const home = scratch();

describe('`variance select --tested` where the graph is blind', () => {
  it('selects as without `--tested` when the pull request imports a module the mainline deletes', async () => {
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
    expect(here.err).toContain(`\`--tested ${queue.tested}\` selects as without it: read alone, the pull request's change selects every test file (it reaches src/other.ts, whose imports the graph could not all read)`);
  });

  it('selects as without `--tested` when the pull request loads a module the mainline changed by a name it builds', async () => {
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
    expect(here.err).toContain(`\`--tested ${queue.tested}\` selects as without it: read alone, the pull request's change selects every test file (it reaches src/other.ts, whose imports the graph could not all read)`);
  });

  it('selects as without `--tested` when the mainline changes a runner config no `before` declares', async () => {
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
    expect(here.err).toContain(`\`--tested ${queue.tested}\` selects as without it: read alone, the mainline's change selects every test file (nothing says which test vitest.config.ts reaches)`);
  });
});
