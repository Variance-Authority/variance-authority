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

  it('is closed to the source of every other package', () => {
    for (const neutral of ['core', 'sense', 'cli', 'mcp', 'playwright-test']) {
      expect(verdict(`packages/${neutral}/src/a.ts`, 'packages/vitest-browser/src/index.ts')).toBe('restricted');
    }
    expect(verdict('packages/vitest-browser/src/a.ts', 'packages/playwright-test/src/index.ts')).toBe('restricted');
    expect(verdict('packages/cli/src/commands/a.ts', `${SELECTION}/jest.ts`)).toBe('restricted');
    expect(verdict('packages/sense/src/other/a.ts', `${SELECTION}/vitest.ts`)).toBe('restricted');
    expect(verdict('packages/mcp/src/a.ts', `${SELECTION}/rstest.ts`)).toBe('restricted');
  });

  it('is closed to the index and the tests beside it, which reach only their own directory', () => {
    expect(verdict(`${SELECTION}/index.ts`, 'packages/playwright-test/src/index.ts')).toBe('restricted');
    expect(verdict(`${SELECTION}/case-fold.test.ts`, 'packages/vitest-browser/src/index.ts')).toBe('restricted');
  });

  it('is open to its own files and to the configurations and cases that use it', () => {
    expect(verdict('packages/vitest-browser/src/node.ts', 'packages/vitest-browser/src/protocol.ts')).toBe('allowed');
    expect(verdict('cases/rstest-case/e2e/rstest.config.mjs', 'packages/playwright-test/src/index.ts')).not.toBe('restricted');
    expect(verdict('vitest.config.mts', `${SELECTION}/vitest.ts`)).not.toBe('restricted');
  });
});

it.todo('a decision file does no I/O and a shell holds no branch beyond dispatch — needs each file to declare its role');
