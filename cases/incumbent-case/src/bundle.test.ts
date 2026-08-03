import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error — a `.mjs` script with no declarations, deliberately: it is
// build tooling this case runs, not a module anything imports at build time.
import { bundle, stale } from '../scripts/bundle.mjs';

/**
 * The staleness guard, tested — which it was not, for the whole of its life.
 *
 * `cases/README.md` states the rule in prose ("a case must refuse a stale
 * bundle") and nothing checked it. That is the one place this repository's own
 * rule — rules are enforced by tests, not described — was unmet, and it mattered:
 * the guard's first implementation compared mtimes, and `yarn typecheck` rewrites
 * every `dist` file with the bytes already in it, so the guard refused a correct
 * bundle on the two commands a developer is told to run in sequence. Nothing
 * caught that either, because the act that verified the guard (touch a file, watch
 * it stop) and the act that produced the false positive are the same act.
 *
 * Every case below is hermetic: a fixture in a temp directory, `stale()` driven
 * through its injected paths. No browser, no build, no `dist`.
 */

const FIXTURES: string[] = [];

function fixture(): { dir: string; outfile: string; manifest: string; input: string } {
  const dir = mkdtempSync(join(tmpdir(), 'variance-bundle-'));
  FIXTURES.push(dir);

  const outfile = join(dir, 'case.js');
  const manifest = join(dir, 'case.inputs.json');
  const input = join(dir, 'entry.ts');

  writeFileSync(input, 'export const answer = 1;\n', 'utf8');
  writeFileSync(outfile, 'var answer = 1;\n', 'utf8');
  write(manifest, dir, outfile, { 'entry.ts': input });

  return { dir, outfile, manifest, input };
}

/** A manifest in the shape `bundle()` writes, over whichever files are handed in. */
function write(
  manifest: string,
  base: string,
  outfile: string,
  inputs: Readonly<Record<string, string>>,
): void {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const digest = (path: string): string =>
    createHash('sha256').update(readFileSync(path)).digest('hex');

  const digests: Record<string, string> = {};
  for (const [key, path] of Object.entries(inputs)) digests[key] = digest(path);

  writeFileSync(
    manifest,
    `${JSON.stringify({
      base,
      entry: Object.keys(inputs)[0],
      inputs: Object.keys(inputs),
      bundle: digest(outfile),
      digests,
    })}\n`,
    'utf8',
  );
}

afterAll(() => {
  for (const dir of FIXTURES) rmSync(dir, { recursive: true, force: true });
});

describe('the bundle guard reads content, not clocks', () => {
  it('passes when nothing has changed', () => {
    const { outfile, manifest } = fixture();
    expect(stale({ outfile, manifest })).toBe(null);
  });

  it('passes when an input was rewritten with the bytes it already had', () => {
    // The regression this whole change exists for. `tsc --build --force` re-emits
    // every `dist` file identically; the mtime version refused, and 44 tests
    // skipped against a bundle that was correct.
    const { outfile, manifest, input } = fixture();
    const later = Date.now() / 1000 + 60;
    utimesSync(input, later, later);

    expect(stale({ outfile, manifest })).toBe(null);
  });

  it('refuses when an input changed, and names it', () => {
    const { outfile, manifest, input } = fixture();
    writeFileSync(input, 'export const answer = 2;\n', 'utf8');

    expect(stale({ outfile, manifest })).toContain('entry.ts');
  });

  it('passes again when an input is reverted to what the bundle was built from', () => {
    // mtime cannot do this: the file is newer than the bundle forever after.
    const { outfile, manifest, input } = fixture();
    writeFileSync(input, 'export const answer = 2;\n', 'utf8');
    writeFileSync(input, 'export const answer = 1;\n', 'utf8');

    expect(stale({ outfile, manifest })).toBe(null);
  });

  it('refuses when an input changed but its mtime went backwards', () => {
    // The old check's false negative, and the original failure exactly: a green
    // head-to-head against an implementation nobody is running. A restored cache
    // or an archive unpacked with its times does this.
    const { outfile, manifest, input } = fixture();
    writeFileSync(input, 'export const answer = 2;\n', 'utf8');
    const earlier = Date.now() / 1000 - 86_400;
    utimesSync(input, earlier, earlier);

    expect(stale({ outfile, manifest })).toContain('entry.ts');
  });

  it('refuses when an input is gone, and says gone rather than different', () => {
    const { outfile, manifest, input } = fixture();
    rmSync(input);

    expect(stale({ outfile, manifest })).toContain('is gone');
  });

  it('refuses when the bundle itself was rewritten', () => {
    // The other false negative: a half-written `case.js` from an interrupted
    // build has the newest mtime in the tree, which the old check read as fresh.
    const { outfile, manifest } = fixture();
    writeFileSync(outfile, 'var answer = 2;\n', 'utf8');

    expect(stale({ outfile, manifest })).toContain('not the one this manifest describes');
  });

  it('refuses a manifest that predates digests rather than reading the half that parses', () => {
    const { outfile, manifest, input } = fixture();
    writeFileSync(manifest, `${JSON.stringify({ base: '/', inputs: [input] })}\n`, 'utf8');

    expect(stale({ outfile, manifest })).toContain('without input digests');
  });

  it('refuses a manifest that records no inputs', () => {
    // It would otherwise match the bundle digest, loop zero times, and return
    // `null` — a check that ran and examined nothing.
    const { dir, outfile, manifest } = fixture();
    write(manifest, dir, outfile, {});

    expect(stale({ outfile, manifest })).toContain('entry point');
  });

  it('refuses when there is no manifest, and when there is no bundle', () => {
    const { outfile, manifest } = fixture();
    rmSync(manifest);
    expect(stale({ outfile, manifest })).toContain('without an input manifest');

    rmSync(outfile);
    expect(stale({ outfile, manifest })).toContain('has not been built');
  });
});

describe('the writer and the reader agree', () => {
  // Every case above hand-builds a manifest in the shape the reader expects, so
  // none of them observes the half being changed. A producer that recorded the
  // wrong `base`, the wrong key shape, or digests resolved against the wrong
  // directory would ship green.
  it('builds a bundle its own guard accepts, and refuses it once an input moves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'variance-bundle-roundtrip-'));
    FIXTURES.push(dir);

    const entry = join(dir, 'entry.ts');
    const helper = join(dir, 'helper.ts');
    const outfile = join(dir, 'out.js');
    const manifest = join(dir, 'out.inputs.json');

    writeFileSync(helper, 'export const answer = 1;\n', 'utf8');
    writeFileSync(entry, "import { answer } from './helper.js';\nconsole.log(answer);\n", 'utf8');

    const previous = process.cwd();
    process.chdir(dir);
    try {
      await bundle({ entry, outfile, manifest });
      expect(stale({ outfile, manifest })).toBe(null);

      writeFileSync(helper, 'export const answer = 2;\n', 'utf8');
      expect(stale({ outfile, manifest })).toContain('helper.ts');
    } finally {
      process.chdir(previous);
    }
  }, 30_000);
});
