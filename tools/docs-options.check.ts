import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKDOWN, ROOT, lineOf } from './markdown.js';

/**
 * The options a package accepts and the options its README describes.
 *
 * An adopter reads the README and never opens the type. An option missing from
 * the table is a capability that ships, is supported, and cannot be found —
 * which is the same outcome as not building it, reached at full cost.
 *
 * The check is deliberately shallow: it asks whether the key is *mentioned*, not
 * whether the sentence about it is true. A rule that tried to grade the prose
 * would be a rule someone deletes the first time it is wrong.
 */

/**
 * Every `*Options` a package publishes, found by walking out from its own
 * `exports` map rather than from a filename.
 *
 * The earlier version of this rule read `packages/*\/src/options.ts`, which is a
 * file exactly one package has. It was green across the repository while 179 of
 * 240 shipped option keys appeared in no README at all — a rule scoped to the
 * one place that had already done the work. What decides membership now is what
 * the package says an importer may reach: an entry in `exports`, and whatever
 * that entry re-exports, transitively.
 *
 * A package with an internal option type is not caught by this and should not
 * be. The escape from the rule is therefore an improvement either way — document
 * the key, or stop exporting the type.
 */
function publicOptionKeys(dir: string): readonly string[] {
  const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')) as {
    readonly exports?: unknown;
  };

  const entries: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.startsWith('./dist/') && value.endsWith('.d.ts')) {
        entries.push(join(ROOT, dir, value.replace(/^\.\/dist\//, 'src/').replace(/\.d\.ts$/, '.ts')));
      }
    } else if (value !== null && typeof value === 'object') {
      for (const nested of Object.values(value)) collect(nested);
    }
  };
  collect(manifest.exports);

  const seen = new Set<string>();
  const queue = entries.filter((file) => existsSync(file));
  const keys = new Set<string>();

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(/export interface \w*Options\s*(?:extends [^{]+)?\{([\s\S]*?)\n\}/g)) {
      for (const key of match[1]!.matchAll(/^ {2}readonly ([a-zA-Z]\w*)\??:/gm)) keys.add(key[1]!);
    }

    // `export * from`, `export { … } from`, `export type { … } from` — the three
    // shapes a barrel is written in here.
    for (const match of source.matchAll(/export (?:type )?(?:\*|\{[\s\S]*?\})\s*(?:as \w+\s*)?from '(\.[^']+)'/g)) {
      for (const candidate of [
        `${match[1]!}.ts`,
        match[1]!.replace(/\.js$/, '.ts'),
        join(match[1]!, 'index.ts'),
      ]) {
        const path = resolve(dirname(file), candidate);
        if (existsSync(path)) {
          queue.push(path);
          break;
        }
      }
    }
  }

  return [...keys];
}

const PACKAGE_OPTIONS = execFileSync('git', ['ls-files', 'packages/*/package.json'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((file) => file.length > 0)
  .map((file) => dirname(file))
  .filter((dir) => existsSync(join(ROOT, dir, 'README.md')))
  .map((dir) => ({ dir, keys: publicOptionKeys(dir) }))
  .filter(({ keys }) => keys.length > 0);

const DOCUMENTED_OPTIONS = PACKAGE_OPTIONS.flatMap(({ dir, keys }) =>
  keys.map((key) => [`${dir}/README.md`, key] as const),
);

describe('every option a package publishes is named in its README', () => {
  it('finds options to check, so this rule cannot pass by reading nothing', () => {
    expect(PACKAGE_OPTIONS.length).toBeGreaterThan(15);
    expect(DOCUMENTED_OPTIONS.length).toBeGreaterThan(100);
  });

  it.each(DOCUMENTED_OPTIONS)('%s names `%s`', (readme, option) => {
    expect(readFileSync(join(ROOT, readme), 'utf8'), `\`${option}\` ships and the README is silent`)
      .toContain(`\`${option}\``);
  });
});

/**
 * A gate does not report **no** about something that ships.
 *
 * `gates.md` scored sitemap discovery as **no** for as long as
 * `route-collector` had a documented `sitemap` option, a `sitemap.ts`, and tests
 * for it. Nothing caught it, because every rule in this file until now checked
 * documentation for *overstatement* — and a capability table understating the
 * product is the same class of defect read from the other side. It costs a
 * reader the feature and costs the project the comparison.
 *
 * Only flat **no** rows are checked. **partial** and **conditional** rows name
 * the part that works, so they mention shipped things by design; grading those
 * would need the rule to understand the sentence, and it does not.
 */
describe('a gate does not say no about a shipped option', () => {
  const OPTIONS = new Set(PACKAGE_OPTIONS.flatMap(({ keys }) => keys).map((key) => key.toLowerCase()));

  const REFUSALS = MARKDOWN.filter((file) => file.endsWith('gates.md')).flatMap((file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    return [...text.matchAll(/^\|([^|]+)\|\s*\*\*no\*\*[^|]*\|/gm)].map(
      (match) => [`${file}:${lineOf(text, match.index)}`, match[1]!.trim()] as const,
    );
  });

  it('finds refusals to check, so this rule cannot pass by reading nothing', () => {
    expect(REFUSALS.length).toBeGreaterThan(3);
    expect(OPTIONS.size).toBeGreaterThan(10);
  });

  it.each(REFUSALS)('%s refuses %s', (_where, requirement) => {
    const shipped = (requirement.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((word) =>
      OPTIONS.has(word),
    );
    expect(
      shipped,
      `this row reports no, and ${shipped.join(', ')} is a supported option — ` +
        'if the refusal is a product boundary, name the boundary rather than the option',
    ).toEqual([]);
  });
});
