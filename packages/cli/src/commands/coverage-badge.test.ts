import { describe, expect, it } from 'vitest';
import { main } from '../bin.fixture.js';
import { EXIT_OPERATOR } from '../exit.js';
import { coverageBadge } from './coverage-badge.js';
import { formatCoverage } from './coverage-text.js';
import type { Coverage } from './coverage.js';

const counted = (count: Partial<Coverage['count']>): Coverage => ({ count, suites: [] }) as unknown as Coverage;

describe('the badge a README links to', () => {
  it('states the figure with its unit, never the word coverage', () => {
    const svg = formatCoverage(counted({ run: 2, regions: 3 }), 'svg');

    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('regions run');
    expect(svg).toContain('66.7%');
    expect(svg.toLowerCase()).not.toContain('coverage');
  });

  it('counts what ran over this text when the record parts it', () => {
    expect(formatCoverage(counted({ run: 3, regions: 4, over: { this: 1 } as NonNullable<Coverage['count']['over']> }), 'svg')).toContain('25.0%');
  });

  it('refuses a count of nothing: no regions is not a figure of 0%', () => {
    expect(() => formatCoverage(counted({ run: 0, regions: 0 }), 'svg')).toThrow('no regions');
  });

  it('sizes the value to its text, so a longer figure is not clipped', () => {
    const width = (svg: string): number => Number(/width="(\d+)"/.exec(svg)![1]);

    expect(width(coverageBadge('100.0%'))).toBeGreaterThan(width(coverageBadge('9%')));
  });

  it.each([['--packages'], ['--fan-in']])('refuses %s, which is no one figure', async (flag) => {
    let err = '';
    const code = await main(['coverage', flag, '--format', 'svg'], {
      out: () => {},
      err: (text) => {
        err += text;
      },
    });

    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('one figure');
  });
});
