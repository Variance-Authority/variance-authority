import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ruleFiles } from '../packages/cli/src/commands/relations-file.js';
import { relationBetween } from '../packages/sense/src/restrictions.js';

/**
 * The runner fences, read through the engine `variance restrictions` runs.
 *
 * `yarn restrictions` is green whenever nothing crosses a fence, and it is
 * just as green with no fence at all. These cases say which imports each
 * `.relations.json` decides, so a rule that is loosened or deleted fails here
 * before the first import slips through it.
 */

const ROOT = join(import.meta.dirname, '..');
const FILES = ruleFiles(ROOT, undefined);

const verdict = (from: string, to: string): string => relationBetween(FILES, from, to)?.rule.type ?? 'unmatched';
const SELECTION = 'packages/sense/src/test-selection';

describe('a runner integration', () => {
  it('is closed to a runner-neutral file beside it', () => {
    expect(verdict(`${SELECTION}/case-fold.ts`, `${SELECTION}/jest-reporter.ts`)).toBe('restricted');
    expect(verdict(`${SELECTION}/case-fold.ts`, `${SELECTION}/vitest.ts`)).toBe('restricted');
    expect(verdict(`${SELECTION}/case-fold.ts`, `${SELECTION}/rstest-loader.ts`)).toBe('restricted');
  });

  it('is open to its own files, a test and the package index', () => {
    expect(verdict(`${SELECTION}/vitest-reporter.ts`, `${SELECTION}/vitest.ts`)).toBe('allowed');
    expect(verdict(`${SELECTION}/probes-placement.test.ts`, `${SELECTION}/rstest.ts`)).toBe('allowed');
    expect(verdict(`${SELECTION}/view.test.tsx`, `${SELECTION}/vitest.ts`)).toBe('allowed');
    expect(verdict(`${SELECTION}/index.ts`, `${SELECTION}/jest-journey-artifact.ts`)).toBe('allowed');
  });

  it('is closed to another runner', () => {
    expect(verdict(`${SELECTION}/vitest.ts`, `${SELECTION}/jest.ts`)).toBe('restricted');
  });

  it('is a package core, sense and the CLI never read', () => {
    for (const neutral of ['core', 'sense', 'cli']) {
      for (const runner of ['vitest-browser', 'playwright-test']) {
        expect(verdict(`packages/${neutral}/src/a.ts`, `packages/${runner}/src/index.ts`)).toBe('restricted');
      }
    }
  });
});

it.todo('a decision file does no I/O and a shell holds no branch beyond dispatch — needs each file to declare its role');
