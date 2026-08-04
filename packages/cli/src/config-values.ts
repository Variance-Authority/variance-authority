import { isAbsolute, resolve } from 'node:path';
import { OperatorError } from './exit.js';

/**
 * The primitive checks every rule in the config is built out of, and the refusal
 * that names a field.
 *
 * Separate from `config.ts` and `config-sections.ts` because these are the only
 * things both of them need, and because the alternative is a cycle: `ConfigError`
 * is a runtime value, so a section parser importing it from the file that imports
 * the section parsers would be a real edge rather than an erased one.
 *
 * Nothing here knows what a setting *means*. Each function answers one question
 * about one value and refuses by naming the field, which is what lets the rules
 * above be as detailed as they are without any of them having to write a message.
 */

/**
 * A refusal that names the field.
 *
 * The field is a separate property and not only part of the message, so a caller
 * that wants to point at a line can, and so the message can never be assembled
 * without it. "Invalid configuration" sends the operator to read the whole file;
 * "`viewport.width` must be a positive integer" sends them to one line.
 */
export class ConfigError extends OperatorError {
  readonly field: string;

  constructor(source: string, field: string, said: string) {
    super(`${source}: \`${field}\` ${said}`);
    this.name = 'ConfigError';
    this.field = field;
  }
}

export interface ParseOptions {
  /** Named in every message. The file path, or `<stdin>`, or a test's label. */
  readonly source: string;
  /**
   * Directory relative paths are resolved against.
   *
   * The config's own directory, not the working directory. A config that means
   * something different depending on where it was invoked from is a config that
   * works locally and points at nothing in CI.
   */
  readonly baseDir: string;
}

export function resolveFrom(baseDir: string, value: string): string {
  return isAbsolute(value) ? value : resolve(baseDir, value);
}

export function kindOf(
  value: unknown,
  field: string,
  known: readonly string[],
  options: ParseOptions,
): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(field, `must be an object, not ${quote(value)}`, options);
  }
  const kind = (value as Record<string, unknown>)['kind'];
  if (typeof kind !== 'string' || !known.includes(kind)) {
    fail(`${field}.kind`, `must be one of ${known.join(', ')}, not ${quote(kind)}`, options);
  }
  return kind;
}

export function object(
  value: unknown,
  field: string,
  known: readonly string[],
  options: ParseOptions,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(field, `must be an object, not ${quote(value)}`, options);
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (known.includes(key)) continue;
    // The field named is the *unknown* one, because that is the character the
    // operator has to delete. Reporting the parent would leave them rereading a
    // block whose every other line is correct.
    fail(
      field === 'the config' ? key : `${field}.${key}`,
      `is not a setting this tool has; it accepts ${known.join(', ')}`,
      options,
    );
  }
  return record;
}

export function text(source: Record<string, unknown>, key: string, options: ParseOptions): string {
  const value = source[key];
  if (typeof value !== 'string') fail(key, `must be a string, not ${quote(value)}`, options);
  return value;
}

export function nonEmpty(
  source: Record<string, unknown>,
  key: string,
  options: ParseOptions,
  field = key,
): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(field, `must be a non-empty string, not ${quote(value)}`, options);
  }
  return value;
}

export function optionalText(
  source: Record<string, unknown>,
  key: string,
  options: ParseOptions,
  field = key,
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    fail(field, `must be a non-empty string when present, not ${quote(value)}`, options);
  }
  return value;
}

export function path(
  source: Record<string, unknown>,
  key: string,
  options: ParseOptions,
): string | undefined {
  return optionalText(source, key, options);
}

export function integer(
  source: Record<string, unknown>,
  key: string,
  field: string,
  options: ParseOptions,
): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(field, `must be a positive integer, not ${quote(value)}`, options);
  }
  return value;
}

export function url(
  source: Record<string, unknown>,
  key: string,
  field: string,
  options: ParseOptions,
): string {
  const value = nonEmpty(source, key, options, field);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(field, `must be an absolute URL, not ${quote(value)}`, options);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(field, `must be http or https, not ${quote(parsed.protocol)}`, options);
  }
  return value;
}

export function strings(
  value: unknown,
  field: string,
  options: ParseOptions,
): readonly string[] {
  if (!Array.isArray(value)) fail(field, `must be an array of strings, not ${quote(value)}`, options);

  return (value as readonly unknown[]).map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(`${field}[${index}]`, `must be a non-empty string, not ${quote(entry)}`, options);
    }
    return entry;
  });
}

export function fail(field: string, said: string, options: ParseOptions): never {
  throw new ConfigError(options.source, field, said);
}

export function quote(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return JSON.stringify(value) ?? String(value);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
