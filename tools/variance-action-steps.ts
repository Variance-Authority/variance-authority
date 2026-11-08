import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * The variance action's steps, read from its YAML as text, since a composite
 * action has no runner here. Shared by the checks that run one step's script.
 */

export const ROOT = resolve(import.meta.dirname, '..');
export const ACTION = join(ROOT, '.github/actions/variance/action.yml');

/** The `if:` of the step whose `name:` or `id:` is `step`. */
export async function conditionOf(step: string): Promise<string> {
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

/** The `run:` block of the step whose `name:` is `step`, unindented. */
export async function runBlock(step: string): Promise<string> {
  const lines = (await readFile(ACTION, 'utf8')).split('\n');
  const named = lines.findIndex((line) => line.trim().replace(/^- /u, '') === `name: ${step}`);
  if (named < 0) throw new Error(`the action has no step ${step}`);
  const run = lines.findIndex((line, at) => at > named && line.trim() === 'run: |');
  const indent = lines[run]!.length - lines[run]!.trimStart().length;
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && line.length - line.trimStart().length <= indent) break;
    body.push(line);
  }
  const inner = Math.min(...body.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length));
  return body.map((line) => line.slice(inner)).join('\n');
}
