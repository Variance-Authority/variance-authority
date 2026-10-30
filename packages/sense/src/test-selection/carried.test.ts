import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createContext, runInContext, type Context } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { EXECUTION_GLOBAL, executionCollectorSource, testSelectionProbes, type ExecutionJournal } from './journal.js';
import { SOURCE, forgetThePage, inRoot } from './__fixtures__/browser-page.js';

afterEach(forgetThePage);

/** A frame's session storage, which every document of one origin in it shares. */
function storage() {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  };
}

/** A top-level document that began at `timeOrigin`, its collector and `code` evaluated. */
function documentOf(code: string, sessionStorage: ReturnType<typeof storage>, timeOrigin: number) {
  const listeners: ((event: { persisted: boolean }) => void)[] = [];
  const page: Context = createContext({
    sessionStorage,
    performance: { timeOrigin, now: () => 5 },
    addEventListener: (event: string, listener: (event: { persisted: boolean }) => void) => {
      if (event === 'pagehide') listeners.push(listener);
    },
  });
  runInContext('globalThis.parent = globalThis;', page);
  runInContext(`{${executionCollectorSource()}}`, page);
  runInContext(code, page);
  return {
    price: (amount: number) => runInContext(`globalThis.__browser_test_price(${amount})`, page),
    leave: (persisted = false) => listeners.forEach((listener) => listener({ persisted })),
    drain: () => JSON.parse(runInContext(`JSON.stringify(globalThis[${JSON.stringify(EXECUTION_GLOBAL)}].drain())`, page)) as ExecutionJournal,
  };
}

describe('a document a navigation replaced', () => {
  it('hands what it entered to the next document of its frame, and to no later one', async () => {
    await inRoot(async (root) => {
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');
      const { code } = testSelectionProbes({ root }).transform.handler(SOURCE, module)!;
      const page = code.replace(/\n;import "[^"]+";$/, '');
      const alone = (amount: number) => {
        const document = documentOf(page, storage(), 0);
        document.price(amount);
        return document.drain().modules[0]!.hits;
      };

      const frame = storage();
      const left = documentOf(page, frame, 1000);
      left.price(20);
      left.leave();
      const next = documentOf(page, frame, 1003);
      next.price(1);
      const drained = next.drain();

      expect(drained.replaced).toBe(1);
      expect(drained.modules.map((entry) => entry.hits)).toEqual([[...new Set([...alone(20), ...alone(1)])].sort((a, b) => a - b)]);
      expect(next.drain().replaced).toBeUndefined();

      // Left before the document this one replaced began: another's.
      const stale = documentOf(page, frame, 1000);
      stale.leave();
      expect(documentOf(page, frame, 2000).drain().replaced).toBeUndefined();
    });
  });

  it('keeps what a document the browser holds to come back to entered, for its own drain', async () => {
    await inRoot(async (root) => {
      const module = resolve(root, 'price.js');
      await writeFile(module, SOURCE, 'utf8');
      const { code } = testSelectionProbes({ root }).transform.handler(SOURCE, module)!;
      const page = code.replace(/\n;import "[^"]+";$/, '');

      const frame = storage();
      const held = documentOf(page, frame, 1000);
      held.price(20);
      held.leave(true);

      expect(documentOf(page, frame, 1003).drain().replaced).toBeUndefined();
      expect(held.drain().modules[0]!.hits.length).toBeGreaterThan(0);
    });
  });
});
