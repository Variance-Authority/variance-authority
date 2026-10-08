import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withTestSelection } from './vitest.js';

/**
 * A module some other plugin changed before the seam read it.
 *
 * The seam is the first plugin in the array, so of the transforms only another
 * wrapper's plugin placed ahead of it can reach the text first, and a `load`
 * hook always does. Either way the text has lines the file on disk does not, and
 * a record cut from it names every region by a line the author never wrote.
 */

const SOURCE = 'export function greet(name) {\n  return `hello ${name}`;\n}\n';

type Transform = (code: string, id: string) => { code: string } | null;

let root: string;
let transform: Transform;

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'variance-changed-ahead-'));
  await writeFile(resolve(root, 'greet.ts'), SOURCE, 'utf8');
  const configured = withTestSelection({}, { root, coverageFile: resolve(root, 'coverage.bin'), include: () => true });
  const plugin = (configured.plugins as unknown as Array<{ transform: Transform }>)[0]!;
  transform = plugin.transform.bind(plugin);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('a module another plugin changed before the seam read it', () => {
  it('is refused, by the name of the file it came from', () => {
    expect(() => transform(`globalThis.compiledAhead = true;\n${SOURCE}`, resolve(root, 'greet.ts'))).toThrow(
      /`greet\.ts` reached `withTestSelection` already changed/,
    );
  });

  it('is recorded when it is the file on disk', () => {
    expect(transform(SOURCE, resolve(root, 'greet.ts'))?.code).toMatch(/__va\(/);
  });

  it('is not refused when the import asked for a variant of the file, such as its text as a string', () => {
    // `?raw` is a module Vite builds from the file, not the file: what it hands
    // over is meant to differ from the disk.
    expect(() => transform(`export default ${JSON.stringify(SOURCE)};\n`, `${resolve(root, 'greet.ts')}?raw`)).not.toThrow();
  });
});
