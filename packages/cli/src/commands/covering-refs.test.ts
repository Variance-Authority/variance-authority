import { describe, expect, it } from 'vitest';
import { formatCovering, type Covering } from './covering.js';

const RESET = 'packages/ioc/src/reset/reset.test.ts';
const at = (name: string, extra: { readonly loaded?: true } = {}) =>
  ({ id: `${RESET} > ${name}`, file: RESET, name, stopped: false, distance: 0, ...extra });
const EVERY = ['configure > honours a second driver', 'configure > reports failures', 'register > stops'].map((name) => at(name));

const WHOLE_FILE: Covering = {
  file: 'packages/ioc/src/reset/index.ts',
  from: 'coverage.bin.cases.bin',
  ranges: [
    { startLine: 1, endLine: 5, state: 'walked', tests: EVERY },
    { startLine: 59, endLine: 61, state: 'alone', tests: [EVERY[2]!] },
    { startLine: 62, endLine: 62, state: 'walked', tests: EVERY },
    { startLine: 70, endLine: 72, state: 'loaded', tests: [at('register > stops', { loaded: true })] },
    { startLine: 80, endLine: 84, state: 'hole', tests: [], stopped: [{ id: 'far', file: 'flow.test.ts', name: 'checks out', stopped: true }] },
  ],
};

describe('an answer with every case named once', () => {
  it('numbers each case once and names every range by those numbers, runs collapsed', () => {
    expect(formatCovering(WHOLE_FILE, 'refs')).toBe([
      'packages/ioc/src/reset/index.ts — 5 recorded ranges',
      '1-5 walked: 2-4',
      '59-61 alone: 4',
      '62 walked: 2-4',
      '70-72 loaded: 4*',
      '80-84 hole: none; stopped first 1',
      '',
      'cases (* inside only while the module evaluated)',
      'flow.test.ts',
      '  1 checks out [far]',
      RESET,
      '  2 configure > honours a second driver',
      '  3 configure > reports failures',
      '  4 register > stops',
      '',
    ].join('\n'));
  });

  it('keeps the text answer to one file heading, and says a repeated list in one line', () => {
    const text = formatCovering(WHOLE_FILE, 'text');

    expect(text).toContain(`lines 1-5 — walked\n  ${RESET}\n    configure > honours a second driver\n`);
    expect(text).toContain('line 62 — walked\n  the same 3 named tests as lines 1-5\n');
    expect(text.split(RESET).length - 1).toBe(3);
  });
});
