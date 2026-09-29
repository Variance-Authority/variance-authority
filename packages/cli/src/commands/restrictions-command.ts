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
import {
  cappedLayers,
  packageLayers,
  publishedSources,
  restrictedImports,
  type CapViolation,
  type LayerCap,
  type RelationRule,
  type RuleFile,
  type Violation,
} from '@variance-authority/sense';
import { EXIT_CLEAN, EXIT_REVIEW, OperatorError, type ExitCode } from '../exit.js';
import type { ParsedRestrictions } from '../restrictions-args.js';

/** The file a folder's rules are written in. */
export const RULE_FILE = '.relations.json';

function parseCap(path: string, at: number, entry: Record<string, unknown>): LayerCap {
  const { for: subject, maxLayer, message } = entry;
  if (typeof subject !== 'string') throw new OperatorError(`${path}, rule ${at + 1}: \`for\` is a folder or a glob, written as a string.`);
  if (typeof maxLayer !== 'number' || !Number.isInteger(maxLayer) || maxLayer < 1) {
    throw new OperatorError(`${path}, rule ${at + 1}: \`maxLayer\` is a whole number from 1; layers start at 1.`);
  }
  if (message !== undefined && typeof message !== 'string') throw new OperatorError(`${path}, rule ${at + 1}: \`message\` is a string.`);
  return { for: subject, maxLayer, ...(message === undefined ? {} : { message }) };
}

function parseRules(path: string, text: string): { rules: RelationRule[]; caps: LayerCap[] } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new OperatorError(`${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const listed = Array.isArray(value) ? value : (value as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(listed)) throw new OperatorError(`${path} holds a list of rules, or an object whose \`rules\` is one.`);
  const caps: LayerCap[] = [];
  const rules: RelationRule[] = [];
  listed.forEach((rule, at) => {
    const entry = rule as Record<string, unknown> | null;
    if (entry !== null && (entry['maxLayer'] !== undefined || entry['for'] !== undefined)) {
      caps.push(parseCap(path, at, entry));
    } else {
      rules.push(parseRule(path, at, entry));
    }
  });
  return { rules, caps };
}

function parseRule(path: string, at: number, entry: Record<string, unknown> | null): RelationRule {
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
}

function ruleFiles(root: string): RuleFile[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--', RULE_FILE, `**/${RULE_FILE}`], { cwd: root, encoding: 'utf8' });
  return listed.split('\0').filter((path) => path !== '').map((path) => {
    const directory = dirname(path);
    return { directory: directory === '.' ? '' : directory, ...parseRules(path, readFileSync(join(root, path), 'utf8')) };
  });
}

/** Layers are read only when a file states a ceiling, and a map that holds none is an error, not a pass. */
function cappedPackages(root: string, files: readonly RuleFile[]): CapViolation[] {
  if (!files.some((file) => (file.caps?.length ?? 0) > 0)) return [];
  const layers = packageLayers(root);
  if (layers?.packages == null) {
    throw new OperatorError('A `maxLayer` is written, but the source index holds no package layers to check it against; `variance index` folds them.');
  }
  return cappedLayers(layers.packages, files);
}

function text(found: readonly Violation[], capped: readonly CapViolation[], files: number, layersRead: boolean): string {
  if (files === 0) return `No ${RULE_FILE} is tracked in this checkout, so no import is restricted.\n`;
  if (found.length === 0 && capped.length === 0) return `No import${layersRead ? ' or layer' : ''} breaks the rules in ${files} ${RULE_FILE} file${files === 1 ? '' : 's'}.\n`;
  const lines = [
    ...found.map((v) => `${v.from} → ${v.to}${v.message === undefined ? '' : `: ${v.message}`} (${join(v.directory, RULE_FILE)})`),
    ...capped.map((v) => `${v.package} is layer ${v.layer}, above the ceiling of ${v.maxLayer}${v.message === undefined ? '' : `: ${v.message}`} (${join(v.directory, RULE_FILE)})`),
  ];
  const counts = [
    found.length > 0 ? `${found.length} restricted import${found.length === 1 ? '' : 's'}` : '',
    capped.length > 0 ? `${capped.length} package${capped.length === 1 ? '' : 's'} above a layer ceiling` : '',
  ].filter((part) => part !== '');
  return `${lines.join('\n')}\n${counts.join(', ')}.\n`;
}

export async function restrictionsOutput(request: ParsedRestrictions): Promise<{ out: string; code: ExitCode }> {
  const files = ruleFiles(request.root);
  const published = await publishedSources(request.root, {
    ci: isCI,
    step: 'variance index',
    announce: (line) => process.stderr.write(`variance: ${line}\n`),
  });
  const found = restrictedImports(published.records, files);
  const capped = cappedPackages(request.root, files);
  const out = request.format === 'json' ? `${JSON.stringify({ violations: found, capped })}\n` : text(found, capped, files.length, files.some((file) => (file.caps?.length ?? 0) > 0));
  return { out, code: found.length > 0 || capped.length > 0 ? EXIT_REVIEW : EXIT_CLEAN };
}
