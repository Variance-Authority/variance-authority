/**
 * The subset of YAML that generated lockfiles are written in.
 *
 * Not a YAML parser, and it must never grow into one. Yarn's and pnpm's
 * serializers emit a narrow, machine-written shape — nested block maps, scalars,
 * and inline collections on a single line — and reading exactly that shape is a
 * hundred lines with no dependency, while reading YAML is a specification with
 * anchors, tags, merge keys and five string styles.
 *
 * The safety argument is the refusal. Everything this does not recognise throws
 * {@link Unreadable}, and a lockfile that cannot be read runs the whole suite
 * with the reason printed — so the failure of this file is a wide run and a work
 * item, never a wrong answer. That is what makes a deliberately incomplete
 * reader the right instrument here.
 *
 * Two shapes are tolerated rather than modelled, because we read neither:
 * an inline `{…}` or `[…]` is kept as the raw text of its line, and a block
 * sequence is consumed and leaves an empty map. Comparing a resolution byte for
 * byte is all the identity of a package needs, and nothing here asks a lockfile
 * what its `cpu` list says.
 */

/** A scalar, or a nested block map. Sequences are consumed and never produced. */
export type YamlValue = string | YamlMap;
export type YamlMap = ReadonlyMap<string, YamlValue>;

/**
 * A lockfile this cannot read.
 *
 * Carried as a sentence rather than a code: it is printed next to a whole run,
 * and *which* construct stopped the reader is the only part of it an operator
 * can act on.
 */
export class Unreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Unreadable';
  }
}

interface Line {
  readonly indent: number;
  readonly key: string;
  /** The text after `key:`, empty when a block follows. */
  readonly value: string;
  readonly number: number;
}

/** Parse the whole document as one block map. */
export function readYaml(text: string): YamlMap {
  const lines = linesOf(text);
  const [map, next] = blockAt(lines, 0, lines[0]?.indent ?? 0);
  if (next < lines.length) {
    throw new Unreadable(`line ${lines[next]!.number}: indentation steps out past the document`);
  }
  return map;
}

/** The value at `key`, when it is a nested map. */
export function mapAt(map: YamlMap, key: string): YamlMap | undefined {
  const value = map.get(key);
  return typeof value === 'string' ? undefined : value;
}

/** The value at `key`, when it is a scalar. */
export function textAt(map: YamlMap, key: string): string | undefined {
  const value = map.get(key);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Strip one layer of quotes.
 *
 * Escapes are not decoded, because every string this reads back — a package
 * name, a version, a resolution — is written by a serializer that had no reason
 * to escape anything in it, and a name that needed an escape would be a name no
 * specifier could spell.
 */
export function unquoted(value: string): string {
  const first = value[0];
  if ((first === '"' || first === "'") && value.length > 1 && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
}

/** YAML's own first characters, none of which a lockfile writer emits unquoted. */
const INDICATORS = new Set(['&', '*', '!', '|', '>', '%', '@', '`']);

function linesOf(text: string): readonly Line[] {
  const lines: Line[] = [];

  for (const [index, raw] of text.split('\n').entries()) {
    const indent = raw.length - raw.trimStart().length;
    const body = raw.slice(indent);
    if (body === '' || body.startsWith('#')) continue;

    // A sequence entry is consumed here rather than at the block level: its
    // parent has already been given an empty map, and what it holds is never
    // read. Marked with an empty key, which no real line can produce.
    if (body.startsWith('- ') || body === '-') {
      lines.push({ indent, key: '', value: '', number: index + 1 });
      continue;
    }

    const split = splitKey(body);
    if (split === undefined) {
      throw new Unreadable(`line ${index + 1}: \`${body.slice(0, 60)}\` is not \`key: value\``);
    }

    // An anchor, an alias, a tag, a block scalar. Each one would read back as a
    // plausible scalar and mean something else entirely, which is the one
    // failure this reader must not have — so they are refused by their first
    // character. A serializer emitting any of them would quote it.
    if (INDICATORS.has(split.value[0] ?? '')) {
      throw new Unreadable(`line ${index + 1}: \`${split.value[0]!}\` starts a construct this does not read`);
    }

    lines.push({ indent, key: unquoted(split.key), value: split.value, number: index + 1 });
  }

  return lines;
}

/**
 * The key and the rest of the line, with a key's own colons left alone.
 *
 * Every key that matters here can contain one: `lodash@npm:^4.17.21` is a key,
 * and splitting it at the first colon would name a package `lodash@npm`. A
 * quoted key ends at its closing quote. A plain one ends where YAML says it
 * does, at the first colon a space or the end of the line follows, so pnpm's
 * unquoted `zod443@https://registry.npmjs.org/zod/-/zod-4.4.3.tgz:` is one key.
 */
function splitKey(body: string): { readonly key: string; readonly value: string } | undefined {
  const quote = body[0];
  if (quote === '"' || quote === "'") {
    const end = body.indexOf(quote, 1);
    if (end === -1 || body[end + 1] !== ':') return undefined;
    return { key: body.slice(0, end + 1), value: body.slice(end + 2).trim() };
  }

  const colon = /:(?: |$)/u.exec(body)?.index;
  if (colon === undefined) return undefined;
  return { key: body.slice(0, colon), value: body.slice(colon + 1).trim() };
}

function blockAt(lines: readonly Line[], start: number, indent: number): [YamlMap, number] {
  const map = new Map<string, YamlValue>();
  let at = start;

  while (at < lines.length) {
    const line = lines[at]!;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new Unreadable(`line ${line.number}: indentation steps in under a scalar`);
    }

    at += 1;
    if (line.key === '') continue;

    if (line.value !== '') {
      map.set(line.key, line.value);
      continue;
    }

    const next = lines[at];
    if (next === undefined || next.indent <= indent) {
      // `key:` with nothing under it — an empty map, which is what pnpm writes
      // for a section it has no entries for.
      map.set(line.key, new Map());
      continue;
    }

    const [nested, after] = blockAt(lines, at, next.indent);
    map.set(line.key, nested);
    at = after;
  }

  return [map, at];
}
