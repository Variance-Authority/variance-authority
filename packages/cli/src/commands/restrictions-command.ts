/**
 * `variance restrictions`: the imports the `.relations.json` rules forbid.
 *
 * Git owns which rule files exist, so they are listed from the index rather
 * than found by walking the tree, and the source index owns the imports. A
 * rule file is data: nothing here runs a file to learn its rules. The exit is
 * `1` when an import is restricted and `0` when none is, because a fence that
 * cannot fail is a comment; whoever does not want the gate does not run it.
 */

// compass: variance-authority.reach.relations

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isCI } from 'ci-info';
import { publishedSources, restrictedImports, type RelationRule, type RuleFile, type Violation } from '@variance-authority/sense';
import { EXIT_CLEAN, EXIT_REVIEW, OperatorError, type ExitCode } from '../exit.js';
import type { ParsedRestrictions } from '../restrictions-args.js';

/** The file a folder's rules are written in. */
export const RULE_FILE = '.relations.json';

function parseRules(path: string, text: string): RelationRule[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new OperatorError(`${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rules = Array.isArray(value) ? value : (value as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(rules)) throw new OperatorError(`${path} holds a list of rules, or an object whose \`rules\` is one.`);
  return rules.map((rule, at): RelationRule => {
    const entry = rule as Record<string, unknown> | null;
    const type = entry?.['type'];
    if (type !== 'allowed' && type !== 'restricted') {
      throw new OperatorError(`${path}, rule ${at + 1}: \`type\` is \`allowed\` or \`restricted\`.`);
    }
    for (const side of ['from', 'to', 'message'] as const) {
      if (entry?.[side] !== undefined && typeof entry[side] !== 'string') {
        throw new OperatorError(`${path}, rule ${at + 1}: \`${side}\` is a string; a RegExp is not JSON, so write a glob.`);
      }
    }
    return {
      type,
      ...(entry?.['from'] === undefined ? {} : { from: entry['from'] as string }),
      ...(entry?.['to'] === undefined ? {} : { to: entry['to'] as string }),
      ...(entry?.['message'] === undefined ? {} : { message: entry['message'] as string }),
    };
  });
}

function ruleFiles(root: string): RuleFile[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--', RULE_FILE, `**/${RULE_FILE}`], { cwd: root, encoding: 'utf8' });
  return listed.split('\0').filter((path) => path !== '').map((path) => {
    const directory = dirname(path);
    return { directory: directory === '.' ? '' : directory, rules: parseRules(path, readFileSync(join(root, path), 'utf8')) };
  });
}

function text(found: readonly Violation[], files: number): string {
  if (files === 0) return `No ${RULE_FILE} is tracked in this checkout, so no import is restricted.\n`;
  if (found.length === 0) return `No import breaks the rules in ${files} ${RULE_FILE} file${files === 1 ? '' : 's'}.\n`;
  const lines = found.map((v) => `${v.from} → ${v.to}${v.message === undefined ? '' : `: ${v.message}`} (${join(v.directory, RULE_FILE)})`);
  return `${lines.join('\n')}\n${found.length} restricted import${found.length === 1 ? '' : 's'}.\n`;
}

export async function restrictionsOutput(request: ParsedRestrictions): Promise<{ out: string; code: ExitCode }> {
  const files = ruleFiles(request.root);
  const published = await publishedSources(request.root, {
    ci: isCI,
    step: 'variance index',
    announce: (line) => process.stderr.write(`variance: ${line}\n`),
  });
  const found = restrictedImports(published.records, files);
  const out = request.format === 'json' ? `${JSON.stringify({ violations: found })}\n` : text(found, files.length);
  return { out, code: found.length > 0 ? EXIT_REVIEW : EXIT_CLEAN };
}
