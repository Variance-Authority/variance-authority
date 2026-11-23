import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export type CoverageFormat = 'text' | 'markdown' | 'json' | 'badge' | 'html';

export interface ParsedCoverage {
  readonly command: 'coverage';
  /** A case index recorded at the base. Only one record can be compared with one base. */
  readonly against?: string;
  /** One declared suite, counted alone. Absent: every suite the root config declares. */
  readonly suite?: string;
  /** `--from <dir>`: count only the source this directory's entry points reach. Absent: every file the index holds. */
  readonly from?: string;
  /** `--packages`: count each package the manifests name on its own, and with what it imports. */
  readonly packages?: true;
  /** `--at-distance <hops>`: count a region as run only when a test file this many import hops from it ran it; the text as typed, read by `parseAtDistance`. */
  readonly atDistance?: string;
  /** `--fan-in`: count, for every region and every file, the test files that called into it. */
  readonly fanIn?: true;
  /** `--session <name>=<path>`, repeatable: V8 coverage a person exported from a run of their own, set beside the record by name. */
  readonly sessions?: readonly { readonly name: string; readonly path: string }[];
  /** `--served <dir>`: the directory a session's `http(s):` scripts were served from. */
  readonly served?: string;
  readonly root: string;
  readonly format: CoverageFormat;
}

export function parseCoverageArgs(flags: Flags): ParsedCoverage {
  noPositionals(flags.positionals, 'coverage');
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'markdown' && format !== 'json' && format !== 'badge' && format !== 'html') {
    throw new OperatorError(`--format must be text, markdown, json, badge or html, not \`${format}\``);
  }
  const against = flags.values.get('--against');
  const suite = flags.values.get('--suite');
  const from = flags.values.get('--from');
  if (from === '') throw new OperatorError('`--from` takes a directory, spelled from the repository root.');
  const packages = flags.present.has('--packages');
  if (packages && from !== undefined) throw new OperatorError('`--from` counts one directory and `--packages` counts every package; pass one of them.');
  const atDistance = flags.values.get('--at-distance');
  const sessions = (flags.repeated.get('--session') ?? []).map(sessionOf);
  const names = sessions.map((session) => session.name);
  const twice = names.find((name, at) => names.indexOf(name) !== at);
  if (twice !== undefined) throw new OperatorError(`two sessions are named \`${twice}\`; give each its own name.`);
  const served = flags.values.get('--served');
  if (served !== undefined && sessions.length === 0) throw new OperatorError('`--served` places a session\'s scripts; pass `--session <name>=<path>` with it.');
  return {
    command: 'coverage',
    ...(against === undefined ? {} : { against: resolve(against) }),
    ...(suite === undefined ? {} : { suite }),
    ...(from === undefined ? {} : { from }),
    ...(packages ? { packages: true as const } : {}),
    ...(atDistance === undefined ? {} : { atDistance }),
    ...(flags.present.has('--fan-in') ? { fanIn: true as const } : {}),
    ...(sessions.length === 0 ? {} : { sessions }),
    ...(served === undefined ? {} : { served: resolve(served) }),
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    format,
  };
}

function sessionOf(value: string): { readonly name: string; readonly path: string } {
  const at = value.indexOf('=');
  if (at <= 0 || at === value.length - 1) throw new OperatorError(`\`--session\` takes <name>=<path>, not \`${value}\``);
  return { name: value.slice(0, at), path: resolve(value.slice(at + 1)) };
}
