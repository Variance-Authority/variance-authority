import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One answer to *which files does a scan open*, held in two languages.
 *
 * The reader tables in `language.ts` and `read.ts` say which
 * extensions some reader claims, and `language_of` in `read_any.rs` says which
 * reader the native seed, read and resolve give each. Nothing compares them at
 * run time.
 *
 * So a language added to the reader tables and not to `language_of` is never
 * seeded: the scan opens none of its files, and every one of them is missing
 * from the graph without a word. That is the shape this file exists to refuse,
 * and it is not hypothetical — it shipped.
 *
 * Both are read out of their source rather than imported, so this answers
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

/** Each reader table by the `Language` variant `language_of` names it with. */
const tables: Record<string, readonly string[]> = {
  Module: listed(read('src/read.ts'), 'MODULE_EXTENSIONS'),
  ...Object.fromEntries(
    ['Style', 'Python', 'Rust', 'Java', 'Kotlin', 'Swift'].map((language) => [
      language,
      listed(read('src/language.ts'), `${language.toUpperCase()}_EXTENSIONS`),
    ]),
  ),
};

const readable = new Set(Object.values(tables).flat());

/** `language_of`'s arms: each extension, by the variant it answers. */
const native = (() => {
  const source = read('native/src/read_any.rs');
  const at = source.indexOf('fn language_of(');
  if (at === -1) throw new Error('read_any.rs does not declare language_of where this check reads it');
  const body = source.slice(at, source.indexOf('\n}\n', at));
  const arms = [...body.matchAll(/^\s*((?:"[^"]+"\s*\|?\s*)+)=> Some\(Language::(\w+)\)/gm)];
  return new Map(arms.flatMap((arm) => [...arm[1]!.matchAll(/"([^"]+)"/g)].map((found) => [found[1]!, arm[2]!] as const)));
})();

describe('the native seeder', () => {
  // A second table is a second answer: the seeder asks `language_of` whether a
  // reader claims a file, so what it seeds is what the reader reads.
  it('seeds by `language_of`, with no table of its own', () => {
    const source = read('native/src/seed.rs');
    expect(source).toContain('language_of(');
    expect(source).not.toMatch(/const \w+: &\[&str\] = &\[/);
  });
});

describe('the native reader and the reader tables', () => {
  for (const [language, extensions] of Object.entries(tables)) {
    for (const extension of extensions) {
      it(`reads ${extension} as ${language}, as its table claims`, () => {
        expect(native.get(extension)).toBe(language);
      });
    }
  }

  for (const extension of native.keys()) {
    it(`claims a reader for ${extension}, which it reads`, () => {
      expect(readable.has(extension)).toBe(true);
    });
  }
});
