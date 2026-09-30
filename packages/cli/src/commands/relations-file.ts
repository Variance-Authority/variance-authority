/**
 * Reading `.relations.json` files: import rules, transitive rules, layer
 * ceilings and tier budgets, each refused with its file and rule number when a
 * field is the wrong shape.
 *
 * Git owns which rule files exist, so they are listed from the index rather
 * than found by walking the tree. A rule file is data: nothing here runs a
 * file to learn its rules, and an entry that mixes two kinds is refused, not
 * half read.
 */

// compass: variance-authority.reach.relations

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LayerCap, RelationRule, RuleFile, TierCap, Tiers } from '@variance-authority/sense';
import { OperatorError } from '../exit.js';

/** The file a folder's rules are written in. */
export const RULE_FILE = '.relations.json';

/** Where an entry sits, for the message that refuses it. */
interface At {
  readonly path: string;
  readonly at: number;
}

function refuse(where: At, said: string): never {
  throw new OperatorError(`${where.path}, rule ${where.at + 1}: ${said}`);
}

/** The `for` and `message` every ceiling carries. */
function subjectOf(where: At, entry: Record<string, unknown>): { for: string; message?: string } {
  const { for: subject, message } = entry;
  if (typeof subject !== 'string') refuse(where, '`for` is a folder or a glob, written as a string.');
  if (message !== undefined && typeof message !== 'string') refuse(where, '`message` is a string.');
  return { for: subject, ...(message === undefined ? {} : { message }) };
}

/** One `for`/`maxLayer` entry. */
function parseCap(where: At, entry: Record<string, unknown>): LayerCap {
  const { maxLayer } = entry;
  if (typeof maxLayer !== 'number' || !Number.isInteger(maxLayer) || maxLayer < 1) {
    refuse(where, '`maxLayer` is a whole number from 1; layers start at 1.');
  }
  return { ...subjectOf(where, entry), maxLayer };
}

/** One `for`/`maxTier` entry, held to the tiers the root config declares. */
function parseTierCap(where: At, entry: Record<string, unknown>, tiers: Tiers | undefined): TierCap {
  const { maxTier } = entry;
  if (tiers === undefined) {
    refuse(where, '`maxTier` names a tier, and the variance.config.json at the repository root declares no `tiers`; declare the budgets there first.');
  }
  if (typeof maxTier !== 'number' || !Number.isInteger(maxTier) || maxTier < 1 || maxTier >= tiers.length) {
    const highest = tiers.length - 1;
    refuse(where, highest === 0
      ? '`maxTier` names a tier from 1, and the root config declares only tier 0, which is unbounded; declare a smaller budget after it.'
      : `\`maxTier\` is a whole number from 1 to ${highest}, the tiers the root config declares; tier 0 is unbounded, so it caps nothing.`);
  }
  return { ...subjectOf(where, entry), maxTier };
}

/** One import rule or transitive rule. */
function parseRule(where: At, entry: Record<string, unknown> | null): RelationRule {
  const type = entry?.['type'];
  if (type !== 'allowed' && type !== 'restricted') refuse(where, '`type` is `allowed` or `restricted`.');
  for (const side of ['from', 'to', 'message'] as const) {
    if (entry?.[side] !== undefined && typeof entry[side] !== 'string') {
      refuse(where, `\`${side}\` is a string; a RegExp is not JSON, so write a glob.`);
    }
  }
  const transitive = entry?.['transitive'];
  if (transitive !== undefined && typeof transitive !== 'boolean') refuse(where, '`transitive` is `true` or `false`.');
  return {
    type,
    ...(entry?.['from'] === undefined ? {} : { from: entry['from'] as string }),
    ...(entry?.['to'] === undefined ? {} : { to: entry['to'] as string }),
    ...(transitive === true ? { transitive } : {}),
    ...(entry?.['message'] === undefined ? {} : { message: entry['message'] as string }),
  };
}

/** A rule file's text as rules and ceilings. */
function parseRules(path: string, text: string, tiers: Tiers | undefined): Omit<RuleFile, 'directory'> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new OperatorError(`${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const listed = Array.isArray(value) ? value : (value as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(listed)) throw new OperatorError(`${path} holds a list of rules, or an object whose \`rules\` is one.`);
  const rules: RelationRule[] = [];
  const caps: LayerCap[] = [];
  const tierCaps: TierCap[] = [];
  listed.forEach((rule, at) => {
    const where = { path, at };
    const entry = rule as Record<string, unknown> | null;
    if (entry === null || (entry['maxLayer'] === undefined && entry['maxTier'] === undefined && entry['for'] === undefined)) {
      rules.push(parseRule(where, entry));
      return;
    }
    const ceiling = entry['maxTier'] === undefined ? 'a layer ceiling (`for`, `maxLayer`)' : 'a tier budget (`for`, `maxTier`)';
    if (entry['maxLayer'] !== undefined && entry['maxTier'] !== undefined) {
      refuse(where, 'an entry holds one ceiling; write `maxLayer` and `maxTier` as two entries.');
    }
    const mixed = ['from', 'to', 'type', 'transitive'].filter((key) => entry[key] !== undefined);
    if (mixed.length > 0) {
      refuse(where, `${ceiling} does not take ${mixed.map((key) => `\`${key}\``).join(', ')}; write the rule as its own entry.`);
    }
    if (entry['maxTier'] === undefined) caps.push(parseCap(where, entry));
    else tierCaps.push(parseTierCap(where, entry, tiers));
  });
  return { rules, caps, ...(tierCaps.length === 0 ? {} : { tierCaps }) };
}

/** Every tracked `.relations.json`, read as data, with the directory it governs. */
export function ruleFiles(root: string, tiers: Tiers | undefined): RuleFile[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--', RULE_FILE, `**/${RULE_FILE}`], { cwd: root, encoding: 'utf8' });
  return listed.split('\0').filter((path) => path !== '').map((path) => {
    const directory = dirname(path);
    return { directory: directory === '.' ? '' : directory, ...parseRules(path, readFileSync(join(root, path), 'utf8'), tiers) };
  });
}
