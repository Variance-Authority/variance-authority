import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { EXECUTION_GLOBAL, executionCollectorSource, type ExecutionJournal } from './journal.js';

// A page runs code under test that a test runner's realm does not, and its
// `varianceBreadcrumb` reads go out with the drain the driver takes.

describe('a page that reads through varianceBreadcrumb', () => {
  it('hands over what the page code read since the last drain, each key and value once, with the site of its first read', () => {
    const page = createContext({});
    runInContext(`{${executionCollectorSource()}}`, page);
    // The two calls \`varianceBreadcrumb\` makes: the value alone, then the
    // \`Error\` that names the site when the recorder says the read is new.
    runInContext(`
      const BREADCRUMB = Symbol.for('variance-authority.test-selection.breadcrumb');
      globalThis.crumb = function crumb(dimension, key, value) {
        const recorder = globalThis[BREADCRUMB];
        if (recorder(dimension, key, value) === true) recorder(dimension, key, value, new Error());
        return value;
      };
    `, page);
    const drained = () =>
      (JSON.parse(runInContext(`JSON.stringify(globalThis[${JSON.stringify(EXECUTION_GLOBAL)}].drain())`, page)) as ExecutionJournal).read;

    runInContext(`crumb('flags', 'checkout', true);\ncrumb('flags', 'checkout', true);\ncrumb('flags', 'checkout', false);\ncrumb('flags', 7, true);`, page, { filename: 'http://app.test/@fs/repo/src/flags.js' });
    expect(drained()).toEqual([
      ['read', ['flags:checkout', 'true', 'http://app.test/@fs/repo/src/flags.js:1', 0xffff]],
      ['read', ['flags:checkout', 'false', 'http://app.test/@fs/repo/src/flags.js:3', 0xffff]],
      ['misused', ['key', '7', 'http://app.test/@fs/repo/src/flags.js:4', 0xffff]],
    ]);
    // A drain closes a window: what the page reads after it is read again.
    expect(drained()).toEqual([]);
    runInContext(`crumb('flags', 'checkout', true);`, page, { filename: 'http://app.test/@fs/repo/src/flags.js' });
    expect(drained()).toEqual([['read', ['flags:checkout', 'true', 'http://app.test/@fs/repo/src/flags.js:1', 0xffff]]]);
  });

  it('leaves a realm that already listens to reads its own recorder', () => {
    const recorder = (): boolean => false;
    const page = createContext({ [Symbol.for('variance-authority.test-selection.breadcrumb')]: recorder });
    runInContext(`{${executionCollectorSource()}}`, page);

    expect((page as Record<symbol, unknown>)[Symbol.for('variance-authority.test-selection.breadcrumb')]).toBe(recorder);
    expect((JSON.parse(runInContext(`JSON.stringify(globalThis[${JSON.stringify(EXECUTION_GLOBAL)}].drain())`, page)) as ExecutionJournal).read).toBeUndefined();
  });
});
