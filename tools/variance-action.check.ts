import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * An accept is kept because a person made it, not because a comparison agreed.
 *
 * On `main` every push accepts what `main` renders, and the run then compares
 * again. A subject that renders differently twice fails that comparison, and
 * that is worth a red check. It is not a reason to throw away the 182 other
 * subjects the push accepted, which is what keeping the store only after a
 * green comparison did: `main` held no baseline, and every pull request
 * compared against nothing.
 *
 * Read from the action itself, since a composite action has no runner here.
 */

const ROOT = resolve(import.meta.dirname, '..');
const ACTION = join(ROOT, '.github/actions/variance/action.yml');

/** The `if:` of the step whose `name:` or `id:` is `step`. */
async function conditionOf(step: string): Promise<string> {
  const lines = (await readFile(ACTION, 'utf8')).split('\n');
  const at = lines.findIndex((line) => /^\s*-\s|^\s+(id|name):/.test(line) && line.trim().endsWith(step));
  if (at < 0) throw new Error(`the action has no step ${step}`);
  let start = at;
  while (start > 0 && !/^\s*-\s/.test(lines[start] ?? '')) start -= 1;
  for (let line = start; line < lines.length; line += 1) {
    const text = lines[line] ?? '';
    if (line > start && /^\s*-\s/.test(text)) break;
    const found = /^\s*-?\s*if:\s*(.*)$/.exec(text);
    if (found?.[1] !== undefined) return found[1];
  }
  throw new Error(`step ${step} has no condition`);
}

describe('the variance action', () => {
  it('keeps the store an accepting run promoted, whatever the comparison after it found', async () => {
    const keep = await conditionOf('what the host keeps');

    expect(keep).toContain("inputs.accept == 'true'");
    expect(keep).toContain("steps.promote.outcome == 'success'");
    expect(keep).not.toContain('exit-code');
  });

  it('promotes as the step the keep step reads', async () => {
    expect(await conditionOf('id: promote')).toBe("${{ inputs.accept == 'true' }}");
  });
});
