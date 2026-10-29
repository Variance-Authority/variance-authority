import { describe, expect, it } from 'vitest';
import { formatCovering, type Covering } from './covering.js';

const RESET = 'packages/ioc/src/reset/reset.test.ts';
const at = (name: string, extra: { readonly loaded?: true } = {}) =>
  ({ id: `${RESET} > ${name}`, file: RESET, name, stopped: false, distance: 0, ...extra });
const EVERY = ['configure > honours a second driver', 'configure > reports failures', 'register > stops'].map((name) => at(name));

const WHOLE_FILE: Covering = {
  file: 'packages/ioc/src/reset/index.ts',
  from: 'coverage.bin',
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
    expect(formatCovering(WHOLE_FILE, 'refs', Date.now())).toBe([
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

  it('names each changed region of a diff by its lines and what it is, a module\'s own region as the top level', () => {
    const changed: Covering = {
      file: 'packages/ioc/src/reset/index.ts',
      from: 'coverage.bin',
      since: 'origin/main',
      changed: [{
        file: 'packages/ioc/src/reset/index.ts',
        recorded: true,
        cases: [],
        regions: [
          { kind: 'module', name: '', startLine: 1, endLine: 90, state: 'walked', tests: EVERY, passengers: [EVERY[0]!] },
          { kind: 'function', name: 'reset', startLine: 59, endLine: 61, state: 'alone', tests: [EVERY[2]!], passengers: [] },
          { kind: 'branch', name: '', startLine: 80, endLine: 84, tests: [], stopped: [] },
        ],
      }],
    };
    expect(formatCovering(changed, 'refs', Date.now()).split('\n').slice(0, 5)).toEqual([
      '1 changed file since origin/main, read from coverage.bin',
      'packages/ioc/src/reset/index.ts',
      '  1-90 the top level walked: 1-3; carried 1',
      '  59-61 function reset alone: 3',
      '  80-84 branch: none, and every case that could have reached it finished; ran while its module evaluated, loaders unnamed',
    ]);
  });

  it('says a place a case ran in another text has no known case, and claims no absence there', () => {
    const file = 'packages/ioc/src/reset/index.ts';
    const beta = at('beta > adds');
    const ranges: Covering = {
      file,
      from: 'coverage.bin',
      ranges: [
        { startLine: 1, endLine: 5, state: 'walked', tests: [EVERY[0]!], stopped: [], overwritten: [beta] },
        { startLine: 7, endLine: 9, tests: [], stopped: [], overwritten: [beta] },
      ],
    };
    expect(formatCovering(ranges, 'refs', Date.now()).split('\n').slice(0, 3)).toEqual([
      `${file} — 2 recorded ranges`,
      '1-5 walked: 1; which other case ran it not known',
      '7-9: none; which case ran it not known',
    ]);
    const line: Covering = { file, from: 'coverage.bin', target: { line: 8 }, tests: [], stopped: [], overwritten: [{ startLine: 7, endLine: 9 }] };
    expect(formatCovering(line, 'refs', Date.now())).toBe(`${file} line 8: none; which case ran it not known at 7-9\n`);
    const changed: Covering = {
      file,
      from: 'coverage.bin',
      since: 'origin/main',
      changed: [{
        file,
        recorded: true,
        cases: [],
        regions: [{ kind: 'function', name: 'beta', startLine: 6, endLine: 10, tests: [], stopped: [], overwritten: [beta], passengers: [] }],
      }],
    };
    expect(formatCovering(changed, 'refs', Date.now()).split('\n').slice(0, 3)).toEqual([
      '1 changed file since origin/main, read from coverage.bin',
      file,
      '  6-10 function beta: none; which case ran it not known',
    ]);
  });

  it('keeps the text answer to one file heading, and says a repeated list in one line', () => {
    const text = formatCovering(WHOLE_FILE, 'text', Date.now());

    expect(text).toContain(`lines 1-5 — walked\n  ${RESET}\n    configure > honours a second driver\n`);
    expect(text).toContain('line 62 — walked\n  the same 3 named tests as lines 1-5\n');
    expect(text).toContain('lines 70-72 — loaded\n  1 case in 1 test file ran it only while their file imported the module\n');
    expect(text.split(RESET).length - 1).toBe(2);
  });
});
