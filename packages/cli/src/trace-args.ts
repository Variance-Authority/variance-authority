import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';
import type { TraceFormat } from './commands/trace-command.js';

export interface ParsedTrace {
  readonly command: 'trace';
  readonly format: TraceFormat;
  readonly suite?: string;
}

/** Parse `trace`: the one format it prints, and the suite whose recording it reads. */
export function parseTraceArgs(flags: Flags): ParsedTrace {
  noPositionals(flags.positionals, 'trace');
  const format = flags.values.get('--format') ?? 'otlp';
  if (format !== 'otlp') throw new OperatorError(`--format must be otlp, not \`${format}\``);
  const suite = flags.values.get('--suite');
  return { command: 'trace', format, ...(suite === undefined ? {} : { suite }) };
}
