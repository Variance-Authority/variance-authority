import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { captureModule } from './captured-modules.js';
import { withTestSelection } from './vitest.js';

/**
 * A module some other plugin changed before the seam read it.
 *
 * The seam's transform is ordered `pre`, so of the transforms only another
 * one ordered `pre` and placed ahead of it can reach the text first, and a
 * `load` hook always does. Either way the text has lines the file on disk does not, and
 * a record cut from it names every region by a line the author never wrote.
 */

const SOURCE = 'export function greet(name) {\n  return `hello ${name}`;\n}\n';

type Transform = (code: string, id: string) => { code: string } | null;
type Plugin = {
  name: string;
  config?: (config: { test: { browser: { enabled: boolean } } }) => void;
  transform?: { handler: Transform };
};

let root: string;
let transform: Transform;
let inPage: () => void;

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'variance-changed-ahead-'));
  await writeFile(resolve(root, 'greet.ts'), SOURCE, 'utf8');
  const configured = withTestSelection({}, { root, coverageFile: resolve(root, 'coverage.bin'), include: () => true });
  const plugin = (configured.plugins as unknown as Plugin[]).find(({ name }) => name === 'variance-authority:test-selection')!;
  transform = plugin.transform!.handler.bind(plugin);
  inPage = () => plugin.config!({ test: { browser: { enabled: true } } });
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

  it('is passed through as it came when the files run in a page, where Vitest serves a mock under the file\'s name', () => {
    // `vi.mock` in a page swaps the module's text in a `load` hook of its own,
    // ordered first: what arrives is the mock, which is not the file and does
    // not run its lines.
    inPage();
    const mock = `export const greet = globalThis.__vitest_mocker__.mocked;\n`;
    expect(transform(mock, resolve(root, 'greet.ts'))).toBeNull();
  });

  it('is recorded when it is the file on disk', () => {
    expect(transform(SOURCE, resolve(root, 'greet.ts'))?.code).toMatch(/__va\(/);
  });

  it.each([
    ['an inline map', `//# sourceMappingURL=data:application/json;base64,${btoa('{"version":3,"sources":[],"mappings":""}')}`],
    ['a map in another directory', '//# sourceMappingURL=../maps/greet.js.map'],
    ['a block comment', '/*# sourceMappingURL=greet.js.map */'],
  ])('is recorded when Vite blanked its source map comment, %s, having read the map', async (_, comment) => {
    // Vite's load blanks every comment its map reader matches, keeping each line where it was.
    const disk = `${SOURCE}${comment}\n`;
    await writeFile(resolve(root, 'greet.ts'), disk, 'utf8');
    const blanked = `${SOURCE}${' '.repeat(comment.length)}\n`;
    expect(transform(blanked, resolve(root, 'greet.ts'))?.code).toMatch(/__va\(/);
    // Named by the file on disk, as a diff of it is written.
    expect(captureModule(root, resolve(root, 'greet.ts'), blanked, () => true, undefined)?.module.sourceDigest).toBe(digestString(disk));
  });

  it('is not refused when the import asked for a variant of the file, such as its text as a string', () => {
    // `?raw` is a module Vite builds from the file, not the file: what it hands
    // over is meant to differ from the disk.
    expect(() => transform(`export default ${JSON.stringify(SOURCE)};\n`, `${resolve(root, 'greet.ts')}?raw`)).not.toThrow();
  });
});
