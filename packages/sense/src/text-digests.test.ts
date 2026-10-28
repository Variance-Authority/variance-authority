import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { digestString } from './digest.js';
import { textDigests } from './text-digests.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'variance-authority-text-digests-'));
  temporary.push(path);
  return path;
}

it('digests each file as its text, as reading it as UTF-8 and digesting the string would', async () => {
  const root = await directory();
  const plain = join(root, 'plain.ts');
  const broken = join(root, 'broken.bin');
  await writeFile(plain, 'export const a = "é";\n');
  // Not UTF-8: a lone continuation byte and a truncated sequence, each read as U+FFFD.
  const bytes = Buffer.from([0x61, 0x80, 0x62, 0xe2, 0x82]);
  await writeFile(broken, bytes);

  const digests = textDigests([plain, broken, plain]);

  expect([...digests]).toEqual([
    [plain, digestString('export const a = "é";\n')],
    [broken, digestString(bytes.toString('utf8'))],
  ]);
});

it('names the file it could not read', async () => {
  const missing = join(await directory(), 'missing.ts');

  expect(() => textDigests([missing])).toThrow(missing);
});
