import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { parseAtDistance } from './covering-args.js';
import { OperatorError } from './exit.js';

export type CoverageFormat = 'text' | 'markdown' | 'json';

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
  /** `--at-distance <hops>`: count a region as run only when a test file this many import hops from it ran it; an open end is `Number.MAX_SAFE_INTEGER`. */
  readonly atDistance?: { readonly from: number; readonly to: number };
  /** `--fan-in`: count, for every region and every file, the test files that called into it. */
  readonly fanIn?: true;
  readonly root: string;
  readonly format: CoverageFormat;
}

export function parseCoverageArgs(flags: Flags): ParsedCoverage {
  noPositionals(flags.positionals, 'coverage');
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'markdown' && format !== 'json') {
    throw new OperatorError(`--format must be text, markdown or json, not \`${format}\``);
  }
  const against = flags.values.get('--against');
  const suite = flags.values.get('--suite');
  const from = flags.values.get('--from');
  if (from === '') throw new OperatorError('`--from` takes a directory, spelled from the repository root.');
  const packages = flags.present.has('--packages');
  if (packages && from !== undefined) throw new OperatorError('`--from` counts one directory and `--packages` counts every package; pass one of them.');
  const atDistance = parseAtDistance(flags);
  return {
    command: 'coverage',
    ...(against === undefined ? {} : { against: resolve(against) }),
    ...(suite === undefined ? {} : { suite }),
    ...(from === undefined ? {} : { from }),
    ...(packages ? { packages: true as const } : {}),
    ...(atDistance === undefined ? {} : { atDistance }),
    ...(flags.present.has('--fan-in') ? { fanIn: true as const } : {}),
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    format,
  };
}
