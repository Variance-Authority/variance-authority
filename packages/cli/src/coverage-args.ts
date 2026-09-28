import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export type CoverageFormat = 'text' | 'markdown' | 'json';

export interface ParsedCoverage {
  readonly command: 'coverage';
  /** A case index recorded at the base. Only one record can be compared with one base. */
  readonly against?: string;
  /** One declared suite, counted alone. Absent: every suite the root config declares. */
  readonly suite?: string;
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
  return {
    command: 'coverage',
    ...(against === undefined ? {} : { against: resolve(against) }),
    ...(suite === undefined ? {} : { suite }),
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    format,
  };
}
