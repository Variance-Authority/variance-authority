import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One answer to *which files does a scan open*, held in two languages.
 *
 * The reader tables in `language.ts`, `read.ts` and `style.ts` say which
 * extensions some reader claims; `EXTENSIONS` in `seed.rs` says which ones the
 * native seeder puts in front of them. Nothing compares the two at run time.
 *
 * So a language added to the reader tables and not to the Rust list is never
 * seeded: the scan opens none of its files, and every one of them is missing
 * from the graph without a word. That is the shape this file exists to refuse,
 * and it is not hypothetical — it shipped.
 *
 * Both lists are read out of their source rather than imported, so this answers
 * on a checkout that has been neither built nor compiled.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '..');
const sense = join(repository, 'packages/sense');

const read = (file: string): string => readFileSync(join(sense, file), 'utf8');

/** The string literals of one `export const NAME = [...]` array. */
function listed(source: string, name: string): readonly string[] {
  const at = source.indexOf(`export const ${name} = [`);
  if (at === -1) throw new Error(`${name} is not declared where this check reads it`);
  const body = source.slice(at, source.indexOf(']', at));
  return [...body.matchAll(/'([^']+)'/g)].map((found) => found[1]!);
}

const readable = new Set([
  ...listed(read('src/read.ts'), 'MODULE_EXTENSIONS'),
  ...listed(read('src/style.ts'), 'STYLE_EXTENSIONS'),
  ...['PYTHON_EXTENSIONS', 'RUST_EXTENSIONS', 'JAVA_EXTENSIONS', 'KOTLIN_EXTENSIONS', 'SWIFT_EXTENSIONS']
    .flatMap((name) => listed(read('src/language.ts'), name)),
]);

const rust = (() => {
  const source = read('native/src/seed.rs');
  const at = source.indexOf('const EXTENSIONS: &[&str] = &[');
  if (at === -1) throw new Error('the native seeder does not declare EXTENSIONS where this check reads it');
  const body = source.slice(at, source.indexOf('];', at));
  // The Rust list spells a suffix without its dot, because that is what
  // `Path::extension` answers with.
  return new Set([...body.matchAll(/"([^"]+)"/g)].map((found) => `.${found[1]!}`));
})();

describe('the native seeder and the reader tables', () => {
  for (const extension of readable) {
    it(`seeds ${extension}, which a reader claims`, () => {
      expect(rust.has(extension)).toBe(true);
    });
  }

  for (const extension of rust) {
    it(`claims a reader for ${extension}, which it seeds`, () => {
      expect(readable.has(extension)).toBe(true);
    });
  }
});
