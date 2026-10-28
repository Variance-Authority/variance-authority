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
 * The seam's first transform is ordered `pre`, so of the transforms only
 * another one ordered `pre` and placed ahead of it can reach the text first,
 * and a `load` hook always does. Either way the text has lines the file on disk
 * does not, and the map Vite composes starts from that text, so probes placed
 * through it would name every region by a line the author never wrote.
 */

const SOURCE = 'export function greet(name) {\n  return `hello ${name}`;\n}\n';

type Transform = (code: string, id: string) => { code: string } | null;
type Plugin = {
  name: string;
  config?: (config: { test: { browser: { enabled: boolean } } }) => Promise<void>;
  transform?: { handler: Transform };
};

let root: string;
let transform: Transform;
let probes: Transform;
let inPage: () => Promise<void>;
let configuredProbes: unknown;

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'variance-changed-ahead-'));
  await writeFile(resolve(root, 'greet.ts'), SOURCE, 'utf8');
  const configured = withTestSelection({}, { root, coverageFile: resolve(root, 'coverage.bin'), include: () => true });
  const plugin = (configured.plugins as unknown as Plugin[]).find(({ name }) => name === 'variance-authority:test-selection')!;
  transform = plugin.transform!.handler.bind(plugin);
  const after = (configured.plugins as unknown as Plugin[]).find(({ name }) => name === 'variance-authority:test-selection-probes')!;
  configuredProbes = after;
  // Vite hands the probes stage the map it composed; the file reaches it unchanged here, so none is read.
  probes = after.transform!.handler.bind({ getCombinedSourcemap: () => ({ sources: [], mappings: '' }) });
  inPage = () => plugin.config!({ test: { browser: { enabled: true } } });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('a module another plugin changed before the seam read it', () => {
  it('is refused where it is a test file the run cuts, by the name of the file and of the `load` hook that rewrote it', async () => {
    // A case says which line of the file on disk was running: a file loaded
    // as other text has none of the author's lines to cut.
    const test = resolve(root, 'greet.test.ts');
    await writeFile(test, SOURCE, 'utf8');
    const loaded = `globalThis.loadedAhead = true;\n${SOURCE}`;
    const loader = { name: 'banner-loader', load: (_id: string) => loaded };
    (configuredProbes as { configResolved(config: unknown): void }).configResolved({ plugins: [loader] });
    loader.load(test);
    expect(() => transform(loaded, test)).toThrow(
      /`greet\.test\.ts` reached `withTestSelection` already changed: the `load` hook of `banner-loader` rewrote the file/,
    );
    // With no hook to name, as where a plugin ordered ahead of the seam rewrote it, the refusal says what could have.
    const other = resolve(root, 'other.test.ts');
    await writeFile(other, SOURCE, 'utf8');
    expect(() => transform(`globalThis.compiledAhead = true;\n${SOURCE}`, other)).toThrow(
      /`other\.test\.ts` reached `withTestSelection` already changed: a `load` hook or a plugin placed ahead of it rewrote the file/,
    );
  });

  it('goes on to the probes where it is not a test file, which place it through the map the step returned', () => {
    // A `load` hook that wrote a banner and mapped every line of the file below it.
    const loaded = `/* banner */\n${SOURCE}`;
    const id = resolve(root, 'greet.ts');
    expect(transform(loaded, id)).toBeNull();
    const after = (configuredProbes as Plugin).transform!.handler.bind({
      getCombinedSourcemap: () => ({ sources: ['greet.ts'], sourcesContent: [SOURCE], mappings: ';AAAA;AACA;AACA' }),
    });
    expect(after(loaded, id)?.code).toMatch(/__va\(/);
    // And refuse it where nothing leads back.
    expect(() => probes(loaded, id)).toThrow(/`greet\.ts`: the transforms ahead of the probes rewrote the file/);
  });

  it('is passed through as it came when the files run in a page, where Vitest serves a mock under the file\'s name', async () => {
    // `vi.mock` in a page swaps the module's text in a `load` hook of its own,
    // ordered first: what arrives is the mock, which is not the file and does
    // not run its lines.
    await inPage();
    const mock = `export const greet = globalThis.__vitest_mocker__.mocked;\n`;
    expect(transform(mock, resolve(root, 'greet.ts'))).toBeNull();
  });

  it('is recorded when it is the file on disk, by probes placed after the transforms', () => {
    expect(transform(SOURCE, resolve(root, 'greet.ts'))).toBeNull();
    expect(probes(SOURCE, resolve(root, 'greet.ts'))?.code).toMatch(/__va\(/);
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

  it('is marked as loaded after the transforms when the import asked for a variant no map leads back from', () => {
    // No probe goes in ahead of the transforms: a variant is probed after
    // them, like the file, and the text as a string holds none of its code.
    const raw = `export default ${JSON.stringify(SOURCE)};\n`;
    const id = `${resolve(root, 'greet.ts')}?raw`;
    expect(transform(raw, id)).toBeNull();
    const marked = probes(raw, id)?.code;
    // The text as it came, and the mark after its last line.
    expect(marked?.startsWith(raw)).toBe(true);
    expect(marked?.slice(raw.length)).toMatch(/^\n;globalThis\.__VA__\.m\("[^"\n]*greet\.ts@~[0-9a-f]+"\);$/);
  });

  it('is probed after the transforms when the import asked for a variant whose map leads back to the file', () => {
    // A single-file component's block, compiled by a plugin that maps it back.
    const id = `${resolve(root, 'greet.ts')}?vue&type=script&lang.ts`;
    const compiled = `/* block */ ${SOURCE}`;
    expect(transform(compiled, id)).toBeNull();
    const after = (configuredProbes as Plugin).transform!.handler.bind({
      getCombinedSourcemap: () => ({ sources: ['greet.ts'], sourcesContent: [SOURCE], mappings: 'AAAA,YAAA;AACA;AACA' }),
    });
    expect(after(compiled, id)?.code).toMatch(/__va\(/);
  });
});
