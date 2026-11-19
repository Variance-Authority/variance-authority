/**
 * The parse rows the source-index reader hands JavaScript, counted at the
 * crossing: a row is held only once it crossed, so what crossed is all a read
 * can go on to hold. A count, where the heap around a collection moves with
 * whatever else the worker did.
 */

// compass: variance-authority.reach.source-index

import { vi } from 'vitest';
import { native } from '../addon.js';
import type { NativeSourceIndexReader } from '../native-source-index.js';

/** Count every parse row a reader opened from now on hands back; read the count with the function returned. */
export function countDecodedParseRows(): () => number {
  const addon = native()!;
  const open = addon.openSourceIndexReader.bind(addon);
  let rows = 0;
  vi.spyOn(addon, 'openSourceIndexReader').mockImplementation((segments) => {
    const reader = open(segments);
    return new Proxy(reader, {
      get(target, name): unknown {
        if (name === 'parse') {
          return (key: string) => {
            const row = target.parse(key);
            if (row !== null) rows += 1;
            return row;
          };
        }
        if (name === 'parses') {
          return (start: number, count: number) => {
            const page = target.parses(start, count);
            rows += (JSON.parse(page) as unknown[]).length;
            return page;
          };
        }
        const value: unknown = Reflect.get(target, name);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    }) satisfies NativeSourceIndexReader;
  });
  return () => rows;
}

/** How many parse rows `read` was handed. */
export async function decodedParseRows(read: () => unknown): Promise<number> {
  const rows = countDecodedParseRows();
  try {
    await read();
    return rows();
  } finally {
    vi.restoreAllMocks();
  }
}
