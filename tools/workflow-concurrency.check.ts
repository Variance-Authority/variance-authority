import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Every push to `main` publishes its record.
 *
 * `check.yml` publishes the mainline record of the commit it ran at. Its
 * concurrency group cancels a run that a newer one in the same group
 * supersedes, which is right for a pull request and loses a commit's record on
 * `main`: two merges a minute apart and the first commit is never published.
 * The group is read from the workflow and evaluated here for both events.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Github {
  readonly ref: string;
  readonly sha: string;
}

/**
 * The value of one `${{ … }}` expression of the shapes `a == 'b' && c || d`,
 * over the `github` context. Anything else throws, so a rewrite into a shape
 * this does not read fails here rather than evaluating to something else.
 */
function evaluate(expression: string, github: Github): string | boolean {
  const term = (text: string): string | boolean => {
    const trimmed = text.trim();
    const literal = /^'([^']*)'$/.exec(trimmed);
    if (literal !== null) return literal[1]!;
    const field = /^github\.(ref|sha)$/.exec(trimmed);
    if (field !== null) return github[field[1] as keyof Github];
    const equal = /^(.+?)\s*==\s*(.+)$/.exec(trimmed);
    if (equal !== null) return term(equal[1]!) === term(equal[2]!);
    throw new Error(`an expression this check does not read: ${trimmed}`);
  };
  const either = expression.split('||');
  for (const [at, alternative] of either.entries()) {
    let value: string | boolean = true;
    for (const part of alternative.split('&&')) {
      value = term(part);
      if (value === false || value === '') break;
    }
    if ((value !== false && value !== '') || at === either.length - 1) return value;
  }
  throw new Error(`an empty expression: ${expression}`);
}

function groupOf(workflow: string, github: Github): string {
  const parsed = parse(readFileSync(resolve(ROOT, '.github/workflows', workflow), 'utf8')) as {
    concurrency?: { group?: string };
  };
  const group = parsed.concurrency?.group;
  if (group === undefined) throw new Error(`${workflow} declares no concurrency group`);
  return group.replace(/\$\{\{(.+?)\}\}/g, (_, expression: string) => String(evaluate(expression, github)));
}

describe('check.yml concurrency', () => {
  const merge = (sha: string): Github => ({ ref: 'refs/heads/main', sha });
  const push = (sha: string): Github => ({ ref: 'refs/pull/12/merge', sha });

  it('puts two merges to main in two groups, so neither cancels the other', () => {
    expect(groupOf('check.yml', merge('a'.repeat(40)))).not.toBe(groupOf('check.yml', merge('b'.repeat(40))));
  });

  it('puts two pushes to one pull request in one group, so the newer cancels the older', () => {
    expect(groupOf('check.yml', push('a'.repeat(40)))).toBe(groupOf('check.yml', push('b'.repeat(40))));
  });
});
