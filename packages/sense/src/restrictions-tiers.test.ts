import { describe, expect, it } from 'vitest';
import { cappedTiers, type RuleFile } from './restrictions.js';

const tiers = [200000, 50000, 20000, 5000, 2000, 1000];
const measured = (name: string, lines: number, unsizedFiles = 0) => ({
  package: `@t/${name}`,
  directory: `packages/${name}`,
  lines,
  unsizedFiles,
});

describe('cappedTiers', () => {
  const files: RuleFile[] = [
    { directory: '', rules: [], tierCaps: [{ for: 'packages/*', maxTier: 3 }] },
    { directory: 'packages', rules: [], tierCaps: [{ for: 'postoffice-*', maxTier: 5, message: 'a stamp is small' }] },
  ];

  it('holds a package to the smallest budget that names it, the highest tier deciding', () => {
    const report = cappedTiers([measured('postoffice-stamps', 1200), measured('checkout', 4000)], files, tiers);
    expect(report.violated.map((found) => [found.package, found.maxTier, found.budget, found.message])).toEqual([
      ['@t/postoffice-stamps', 5, 1000, 'a stamp is small'],
    ]);
    expect(report.undecided).toEqual([]);
  });

  it('calls a closure over budget on its known lines violated, whatever it could not size', () => {
    const report = cappedTiers([measured('checkout', 6000, 4)], files, tiers);
    expect(report.violated.map((found) => found.package)).toEqual(['@t/checkout']);
  });

  it('calls a closure that fits on its known lines and reached unsized code undecided, never passing', () => {
    const report = cappedTiers([measured('checkout', 4000, 2), measured('search', 4000)], files, tiers);
    expect(report.violated).toEqual([]);
    expect(report.undecided.map((found) => [found.package, found.unsizedFiles])).toEqual([['@t/checkout', 2]]);
  });
});
