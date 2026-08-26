import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Markdown, and the two views of it every documentation rule needs.
 *
 * Shared because reading the file list three times is three chances to disagree
 * about what counts as documentation, not because the code is long.
 */

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A changelog is written by `changeset version`, and a file under `.changeset/`
 * is consumed by it. Every rule below reads prose somebody chose the words of —
 * a link worth resolving, an example worth compiling, a claim worth holding to
 * source — and holding generated output to any of them holds a generator to a
 * standard it cannot answer for. `.changeset/README.md` is authored and stays.
 */
const GENERATED = /(^|\/)CHANGELOG\.md$|^\.changeset\/(?!README\.md$)/;

export const MARKDOWN: readonly string[] = execFileSync('git', ['ls-files', '*.md'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((file) => !GENERATED.test(file));

/** Markdown with fenced blocks blanked out, so a prose rule cannot read an example. */
export function prose(file: string): string {
  return readFileSync(resolve(ROOT, file), 'utf8').replace(
    /^```[\w-]*\n[\s\S]*?^```/gm,
    (block) => block.replace(/[^\n]/g, ' '),
  );
}

export function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

export interface Fence {
  readonly file: string;
  /** Line of the opening ``` in the markdown, 1-based. */
  readonly line: number;
  readonly lang: string;
  readonly code: string;
}

export function fencesIn(file: string): readonly Fence[] {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  const found: Fence[] = [];

  for (const match of text.matchAll(/^```([\w-]*)\n([\s\S]*?)^```/gm)) {
    found.push({
      file,
      line: text.slice(0, match.index).split('\n').length,
      lang: match[1] ?? '',
      code: match[2] ?? '',
    });
  }
  return found;
}

export const FENCES: readonly Fence[] = MARKDOWN.flatMap(fencesIn);
