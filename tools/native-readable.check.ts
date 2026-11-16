import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One answer to *which files does a scan open*, held in two languages.
 *
 * The public reader tables and native reader dispatch say which extensions
 * some reader claims; `EXTENSIONS` in `seed.rs` says which ones the
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
  ...['STYLE_EXTENSIONS', 'PYTHON_EXTENSIONS', 'RUST_EXTENSIONS', 'JAVA_EXTENSIONS', 'KOTLIN_EXTENSIONS', 'SWIFT_EXTENSIONS']
    .flatMap((name) => listed(read('src/language.ts'), name)),
]);

function rustListed(file: string, name: string): readonly string[] {
  const source = read(file);
  const at = source.indexOf(`const ${name}:`);
  if (at === -1) throw new Error(`${file} does not declare ${name} where this check reads it`);
  const start = source.indexOf('[', source.indexOf('=', at));
  const body = source.slice(start, source.indexOf(']', start));
  return [...body.matchAll(/"([^"]+)"/g)].map((found) => found[1]!);
}

const nativeReadable = (() => {
  const source = read('native/src/source_read.rs');
  const at = source.indexOf('pub(crate) fn language(file:');
  if (at === -1) throw new Error('the native reader does not declare language where this check reads it');
  const body = source.slice(at, source.indexOf('_ => None', at));
  const languages = [...body.matchAll(/Some\(([^)]+)\) => Some\("[^"]+"\)/g)]
    .flatMap((found) => [...found[1]!.matchAll(/"([^"]+)"/g)].map((literal) => `.${literal[1]!}`));
  return new Set([
    ...rustListed('native/src/resolve.rs', 'MODULE_EXTENSIONS'),
    ...rustListed('native/src/source_style.rs', 'EXTENSIONS'),
    ...languages,
  ]);
})();

// `Path::extension` gives the native seeder a suffix without its dot.
const seeded = new Set(rustListed('native/src/seed.rs', 'EXTENSIONS').map((extension) => `.${extension}`));

for (const [owner, claims] of [['public tables', readable], ['native readers', nativeReadable]] as const) {
  describe(`the native seeder and ${owner}`, () => {
    for (const extension of claims) {
      it(`seeds ${extension}, which a reader claims`, () => {
        expect(seeded.has(extension)).toBe(true);
      });
    }

    for (const extension of seeded) {
      it(`claims a reader for ${extension}, which it seeds`, () => {
        expect(claims.has(extension)).toBe(true);
      });
    }
  });
}
