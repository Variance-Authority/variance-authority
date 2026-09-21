import { describe, expect, it } from 'vitest';
import type { CoveringChange, CoveringTest } from './reverse.js';
import { formatCoveringChange } from './covering-change-text.js';

const witness = (name: string): CoveringTest => ({
  id: `test/cart.test.ts > ${name}`,
  file: 'test/cart.test.ts',
  name,
  distance: 0,
});

const region = (over: Partial<CoveringChange['regions'][number]> = {}) => ({
  kind: 'function',
  name: 'priceOf',
  startLine: 1,
  endLine: 6,
  tests: [],
  passengers: [],
  ...over,
});

const file = (over: Partial<CoveringChange> = {}): CoveringChange => ({
  file: 'src/total.ts',
  recorded: true,
  regions: [],
  cases: [],
  ...over,
});

describe('formatCoveringChange', () => {
  it('leads with the two counts a reviewer acts on, before any region', () => {
    const text = formatCoveringChange([
      file({ regions: [region(), region({ startLine: 8, endLine: 10, tests: [witness('guest')] })] }),
    ]);

    expect(text.split('\n')[0]).toBe(
      '1 changed file, 2 changed regions: 1 nothing covered, 1 covered by one case.',
    );
  });

  it('says where it read, and says nothing when the caller cannot honestly say', () => {
    const changed = [file()];

    expect(formatCoveringChange(changed, { since: 'main', from: '.variance/index', at: 'abc1234' }))
      .toContain('Read from .variance/index, recorded at abc1234.');
    expect(formatCoveringChange(changed, { from: '.variance/index' }))
      .not.toContain('recorded at');
    expect(formatCoveringChange(changed)).not.toContain('Read from');
  });

  it('separates a file the run never loaded from a file nothing covered', () => {
    expect(formatCoveringChange([file({ recorded: false })]))
      .toContain('no row — the recorded run never loaded this file');
    expect(formatCoveringChange([file()]))
      .toContain('in the index, and the change landed on no recorded region of it');
  });

  it('calls a single witness what it is, rather than reporting a count of one', () => {
    expect(formatCoveringChange([file({ regions: [region({ tests: [witness('guest')] })] })]))
      .toContain('1-6 function priceOf — 1 case, and it is the only witness');
  });

  it('counts a case that was only present while the module evaluated apart from one that went there', () => {
    const text = formatCoveringChange([
      file({ regions: [region({ tests: [witness('guest')], passengers: [witness('staff')] })] }),
    ]);

    expect(text).toContain('1 case, and it is the only witness (+1 carried in while the module evaluated)');
    expect(text).toContain('    guest — test/cart.test.ts [test/cart.test.ts > guest]');
    // The passenger is counted, not named as a witness: it was present, it did
    // not go there, and a reader picking a test to run must not pick it.
    expect(text).not.toContain('    staff —');
  });

  it('prints no call-stack depth beside a witness, because nothing here records one', () => {
    expect(formatCoveringChange([file({ regions: [region({ tests: [witness('guest')] })] })]))
      .not.toMatch(/depth \d/);
  });

  it('reports a changed test file as what it declares, not as uncovered source', () => {
    const text = formatCoveringChange([
      file({ file: 'test/cart.test.ts', recorded: false, cases: [witness('guest'), witness('staff')] }),
    ]);

    expect(text).toContain('a test file — 2 named cases declared here');
    expect(text).not.toContain('no row');
  });

  it('says how much of the diff the reading is not about', () => {
    const text = formatCoveringChange([
      file({ regions: [region()] }),
      file({ file: 'src/tax.ts', recorded: false }),
    ]);

    expect(text).toContain('1 changed path has no row here at all.');
  });
});
