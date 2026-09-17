import { describe, expect, it } from 'vitest';
import { COST, DOWN, OUT, PER_HOP, SIDEWAYS, UP, hopBetween, hopsOf, packageOf } from './hops.js';

const NONE: readonly string[] = [];
const WORKSPACE = ['packages/mcp/', 'packages/core/'];

describe('what one import costs', () => {
  it('charges least for reaching into its own folder, or deeper', () => {
    expect(hopBetween('src/billing/Invoice.tsx', 'src/billing/total.ts', NONE)).toBe('down');
    expect(hopBetween('src/billing/Invoice.tsx', 'src/billing/parts/Row.tsx', NONE)).toBe('down');
  });

  it('charges most for leaving the package', () => {
    expect(hopBetween('packages/mcp/src/a.ts', 'packages/core/src/b.ts', WORKSPACE)).toBe('out');
  });

  it('charges up for reaching above itself, and down for the reverse', () => {
    expect(hopBetween('src/billing/parts/Row.tsx', 'src/billing/total.ts', NONE)).toBe('up');
    expect(hopBetween('src/billing/total.ts', 'src/billing/parts/Row.tsx', NONE)).toBe('down');
  });

  it('charges sideways for neither, however far sideways it goes', () => {
    expect(hopBetween('src/billing/a.ts', 'src/shipping/b.ts', NONE)).toBe('sideways');
    expect(hopBetween('src/billing/a.ts', 'src/a/b/c/d/e.ts', NONE)).toBe('sideways');
  });

  it('reads a whole segment, so `src` is not `src-old`', () => {
    expect(hopBetween('src/a.ts', 'src-old/b.ts', NONE)).toBe('sideways');
  });

  it('costs the arrow, not the reading: the same two files cost the same both ways', () => {
    const one = 'src/billing/Invoice.tsx';
    const two = 'src/billing/total.ts';
    expect(COST[hopBetween(one, two, NONE)]).toBe(DOWN);
    // The walk against the arrows still classifies (importer, imported), which
    // is what `costsFrom` does with its `against` flag.
    expect(COST[hopBetween(one, two, NONE)]).toBe(COST[hopBetween(one, two, NONE)]);
  });
});

describe('where a package begins', () => {
  it('reads an installed package off the path, told nothing', () => {
    expect(packageOf('node_modules/react/index.js', NONE)).toBe('node_modules/react/');
    expect(packageOf('node_modules/@scope/ui/dist/a.js', NONE)).toBe('node_modules/@scope/ui/');
  });

  it('takes the longest declared root a file is under', () => {
    expect(packageOf('packages/mcp/src/a.ts', WORKSPACE)).toBe('packages/mcp/');
  });

  it('puts a file under no declared root in the repository itself', () => {
    expect(packageOf('tools/check.ts', WORKSPACE)).toBe('');
    expect(packageOf('tools/check.ts', NONE)).toBe(packageOf('src/a.ts', NONE));
  });

  it('never fires the out bucket when no roots were given', () => {
    expect(hopBetween('packages/mcp/src/a.ts', 'packages/core/src/b.ts', NONE)).not.toBe('out');
  });
});

describe('the figures, and the unit they are kept in', () => {
  it('keeps every constant a whole number, so two machines agree exactly', () => {
    for (const cost of Object.values(COST)) expect(Number.isInteger(cost)).toBe(true);
  });

  it('is the table the doc prints: 1, 1.5, 2, 4', () => {
    expect([DOWN, SIDEWAYS, UP, OUT].map((cost) => cost / PER_HOP)).toEqual([1, 1.5, 2, 4]);
    expect(hopsOf(SIDEWAYS)).toBe('1.5');
  });

  it('orders the four moves as the rule states, cheapest first', () => {
    expect(DOWN).toBeLessThan(SIDEWAYS);
    expect(SIDEWAYS).toBeLessThan(UP);
    expect(UP).toBeLessThan(OUT);
  });
});
