import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKDOWN, ROOT } from './markdown.js';

/**
 * The weaker question a proposal can answer.
 *
 * A spec's fence cannot be compiled — it describes code the spec exists to argue
 * for, and demanding it compile would invert what a spec is. But it does not only
 * propose. It also *borrows*: `Digest`, `ProfileId`, `SemanticSnapshot` are the
 * repository's, quoted so the proposal has something to attach to. Those borrowed
 * names are checkable.
 *
 * ## What this catches, and the much larger thing it does not
 *
 * It catches a rename to *nothing*: `Digest` becoming `Hash` with no `Digest`
 * left anywhere. It does **not** catch a rename to something else, and it does
 * not compare shapes at all. Spec 0002 was measured against its own
 * implementation while the original of this rule was written: every type it names
 * existed, and its `HistoryStore` had drifted in all five methods anyway. That
 * was found by reading. See ADR-0014 for why member comparison was tried and
 * rejected rather than merely skipped.
 *
 * ## Why this is regexes and not a parser
 *
 * The original walked the TypeScript AST — of the fence, and of every tracked
 * source file, to build the roster. That is a compiler in a test to answer *does
 * this word appear as an exported name somewhere*, and it is the reason the repo
 * kept TypeScript 5 alive after moving the build to 7.
 *
 * The downgrade is real and bounded: a capitalised word in a fence is treated as
 * a type reference, so the rule now over-collects. It cannot produce a false
 * *pass* — a missing name is still missing — only a false failure, which is
 * fixed by naming the word in {@link NOT_A_TYPE} with a reason.
 */

const PROPOSAL_DIRS = ['docs/specs/', 'docs/context/adr/'];

/** Capitalised words a fence can use that are nobody's exported type. */
const NOT_A_TYPE = new Set([
  // The language's own.
  'Array',
  'Awaited',
  'Boolean',
  'Buffer',
  'Date',
  'Error',
  'Extract',
  'Map',
  'Math',
  'NonNullable',
  'Number',
  'Object',
  'Omit',
  'Parameters',
  'Partial',
  'Pick',
  'Promise',
  'Readonly',
  'ReadonlyArray',
  'ReadonlyMap',
  'ReadonlySet',
  'Record',
  'Required',
  'ReturnType',
  'Set',
  'String',
  'Uint8Array',
  // Prose and identifiers that happen to be capitalised inside a fence.
  'JSON',
  'TODO',
]);

/**
 * Every exported name in tracked source, found by reading `export` lines.
 *
 * Source rather than built `.d.ts`, so this needs no build — the same property
 * the original had, kept deliberately: a rule that only works after a successful
 * build cannot report on a repository that does not compile.
 */
const EXPORTED: ReadonlySet<string> = (() => {
  const names = new Set<string>();
  const files = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file));

  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const match of text.matchAll(
      /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|type|class|enum|function|const|let|var)\s+(\w+)/gm,
    )) {
      names.add(match[1]!);
    }
    // `export { a, b as c }` — the exported name is what follows `as`, or the
    // bare identifier when there is no rename.
    for (const clause of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
      for (const part of clause[1]!.split(',')) {
        const named = /(?:\bas\s+)?(\w+)\s*$/.exec(part.trim());
        if (named !== null) names.add(named[1]!);
      }
    }
  }
  return names;
})();

interface Fence {
  readonly file: string;
  readonly line: number;
  readonly code: string;
}

const FENCES: readonly Fence[] = MARKDOWN.filter((file) =>
  PROPOSAL_DIRS.some((dir) => file.startsWith(dir)),
).flatMap((file) => {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const found: Fence[] = [];

  for (const match of text.matchAll(/^```(ts|tsx)\n([\s\S]*?)^```/gm)) {
    found.push({
      file,
      line: text.slice(0, match.index).split('\n').length,
      code: match[2] ?? '',
    });
  }
  return found;
});

/** Capitalised words the fence uses and does not itself declare. */
function referenced(code: string): ReadonlySet<string> {
  const declared = new Set<string>();
  for (const match of code.matchAll(
    /\b(?:interface|type|class|enum|function)\s+(\w+)|\bnamespace\s+(\w+)/g,
  )) {
    declared.add((match[1] ?? match[2])!);
  }

  const names = new Set<string>();
  // Comments carry prose, and prose is full of capitalised words that are not
  // types. Stripped before collecting rather than allowlisted afterwards.
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  for (const match of bare.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    const name = match[1]!;
    if (!declared.has(name) && !NOT_A_TYPE.has(name)) names.add(name);
  }
  return names;
}

describe('every type a proposal names still exists', () => {
  it('finds proposals to check, so this cannot pass by reading nothing', () => {
    expect(FENCES.length).toBeGreaterThan(0);
  });

  it('finds exported names to check them against', () => {
    // A roster that came out empty would make every fence pass. It has to be
    // large, not merely non-zero.
    expect(EXPORTED.size).toBeGreaterThan(100);
  });

  it.each(FENCES.map((fence) => [`${fence.file}:${fence.line}`, fence] as const))(
    '%s',
    (where, fence) => {
      const missing = [...referenced(fence.code)]
        .filter((name) => !EXPORTED.has(name))
        .map((name) => `${where} → ${name}`);

      expect(missing).toEqual([]);
    },
  );
});
