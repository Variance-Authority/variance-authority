import { digestBytes } from '@variance-authority/core/format';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import { SOURCE_INDEX_VERSION, sourceIndexChain, sourceIndexWrittenIn } from '@variance-authority/sense';
import { BEFORE } from './mainline-fixture.js';

/** The format version of the release before this one. */
export const OLDER = SOURCE_INDEX_VERSION - 1;

/** Five modules that import one another, the record's `src/total.ts` among them. */
export const SOURCES: Readonly<Record<string, string>> = {
  'src/total.ts': BEFORE,
  'src/a.ts': "import { applyDiscount } from './total';\nexport const a = applyDiscount(10);\n",
  'src/b.ts': "import { a } from './a';\nexport const b = a + 1;\n",
  'src/c.ts': "import { b } from './b';\nexport const c = b + 1;\n",
  'src/d.ts': "import { c } from './c';\nexport const d = c + 1;\n",
  'test/total.test.ts': "import { applyDiscount } from '../src/total';\nit('discounts', () => applyDiscount(1));\n",
  'test/other.test.ts': "it('stands alone', () => {});\n",
};

/**
 * The index at `path` as the release before this one wrote it: each segment's
 * header names the older format version, and every digest is its bytes' own.
 */
export async function asOlderRelease(path: string): Promise<void> {
  // Every caller indexes first; the index it wrote is the one rewritten.
  const chain = (await sourceIndexChain(path))!;
  const length = chain.manifest.readUInt32LE(8);
  const manifest = JSON.parse(chain.manifest.subarray(12, 12 + length).toString('utf8')) as { segments: { digest: string; length: number }[] };
  const current = `"version":${String(SOURCE_INDEX_VERSION)},`;
  manifest.segments = [];
  for (const segment of chain.segments) {
    const bytes = await readFile(segment.path);
    const at = bytes.indexOf(current);
    expect(at).toBeGreaterThan(0);
    const older = Buffer.concat([bytes.subarray(0, at), Buffer.from(`"version":${String(OLDER)},`), bytes.subarray(at + current.length)]);
    const digest = digestBytes(older);
    await writeFile(join(`${path}.segments`, `${digest.replace(':', '-')}.bin`), older);
    await rm(segment.path);
    manifest.segments.push({ digest, length: older.length });
  }
  const json = Buffer.from(JSON.stringify(manifest), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(json.length);
  await writeFile(path, Buffer.concat([chain.manifest.subarray(0, 8), head, json]));
  expect(await sourceIndexWrittenIn(path)).toBe(OLDER);
}
