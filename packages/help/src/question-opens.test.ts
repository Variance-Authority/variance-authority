import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishing } from './__fixtures__/published-then-written.js';
import { readWorkspace } from './read.js';
import { symbol } from './tools/symbol.js';

/**
 * How many times one question opens the source index: the calls that hand the
 * addon the chain's path, each of which reads and hashes every segment. A name
 * declared in several files is asked about once per declaration, and every one
 * of those asks used to open the chain again.
 */

const fixture = publishing();
beforeEach(fixture.before);
afterEach(fixture.after);

/** The addon the source package loaded, the same object its readers call into. */
async function addon(): Promise<Record<string, unknown>> {
  const sense = fileURLToPath(import.meta.resolve('@variance-authority/sense'));
  const { native } = (await import(pathToFileURL(join(dirname(sense), 'addon.js')).href)) as { native: () => Record<string, unknown> | undefined };
  return native()!;
}

/** Every call into `scanner` that is handed `path`, counted while `ask` runs. */
async function opensOf(scanner: Record<string, unknown>, path: string, ask: () => unknown): Promise<number> {
  const kept = new Map<string, unknown>();
  let opens = 0;
  for (const [name, call] of Object.entries(scanner)) {
    if (typeof call !== 'function') continue;
    kept.set(name, call);
    scanner[name] = function (this: unknown, ...args: unknown[]) {
      if (args.includes(path)) opens += 1;
      return (call as (...args: unknown[]) => unknown).apply(this, args);
    };
  }
  try {
    await ask();
  } finally {
    for (const [name, call] of kept) scanner[name] = call;
  }
  return opens;
}

describe('one question about a name declared in several files', () => {
  it('opens the source index once', async () => {
    const declared = (file: string) => `export function taxOf(amount: number): number {\n  return amount / ${file.length};\n}\n`;
    const root = await fixture.published({
      'packages/kit/src/vat.ts': declared('vat'),
      'packages/kit/src/duty.ts': declared('duty'),
      'packages/till/package.json': JSON.stringify({ name: '@acme/till' }),
      'packages/till/src/levy.ts': declared('levy'),
    });
    const help = await readWorkspace(root);

    const opens = await opensOf(await addon(), sourceIndexPath(root), () => symbol.run(help, { name: 'taxOf' }, { root }));

    expect(opens).toBe(1);
  });
});
