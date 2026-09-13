import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/**
 * The config the parsers accept, and the schema an editor reads.
 *
 * `packages/cli/schema/variance.config.schema.json` is what makes the
 * configuration statically discoverable: an operator gets completion and a
 * refusal before the run, and an agent reading the repository gets an answer to
 * *what may this file say* without executing anything. All of that is worth
 * exactly as much as its agreement with `parseConfig`, and a hand-written schema
 * nobody checks is worse than no schema — it answers confidently and wrongly.
 *
 * So the schema is held to the source rather than trusted. Every closed object
 * in the config is a `known` list handed to `object(...)` in `packages/cli/src`,
 * and every closed object in the schema is a `properties` map under
 * `additionalProperties: false`. This rule reads both and requires the two
 * collections to be the same set of key lists. Adding a config key without a
 * schema entry fails here, and so does a schema entry no parser would accept.
 *
 * The lists are read off the parsed tree, never off the text. `known` is
 * sometimes an array literal, sometimes a named constant, and once a spread of
 * two — a regular expression would have to understand all three and would
 * quietly read none of them the day a fourth appears.
 *
 * ## What is matched, and what is not
 *
 * Key lists are matched as *sets*, without a table saying which parser owns
 * which definition. Such a table is a third thing to keep current, and the sets
 * are already distinct: no two closed objects in this config accept the same
 * keys. A renamed definition therefore costs nothing and a changed key list
 * fails, which is the split worth having.
 *
 * Vocabularies are not checked exhaustively — only the `kind` discriminators,
 * which are the ones a schema most usefully completes and the ones a reader of a
 * `oneOf` would otherwise have to take on faith. `profile` is checked because
 * `config.ts` deliberately refuses to hold a literal list of profiles, so the
 * one written here is a copy of `core`'s and would otherwise be the only place
 * in the repository that can silently fall behind a tier the system gained.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PARSERS = join(ROOT, 'packages/cli/src');
const SCHEMA = join(ROOT, 'packages/cli/schema/variance.config.schema.json');

/**
 * Closed objects in the schema that no `object(...)` call produces.
 *
 * One, and it is named rather than exempted by shape. `{ "env": "NAME" }` is
 * read by `secret` and `declaredSecret` in `config-values.ts`, field by field,
 * because the alternative shape is a bare string and `object` answers one
 * question about one value. The schema still has to describe it, so the rule
 * that every schema object is claimed by a parser has exactly one exception and
 * that exception has a reason attached.
 */
const HAND_READ: readonly (readonly string[])[] = [['env']];

type Node = Record<string, unknown> & { readonly type: string };

function walk(node: unknown, visit: (node: Node) => void): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, visit);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record['type'] === 'string') visit(record as Node);
  for (const value of Object.values(record)) walk(value, visit);
}

/** `x as const` is the same expression with a note for the compiler. */
function unwrap(node: unknown): Node | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  let current = node as Node | undefined;
  while (current !== undefined && current !== null && current.type === 'TSAsExpression') {
    current = current['expression'] as Node | undefined;
  }
  return current ?? undefined;
}

function literal(node: unknown): string | undefined {
  const inner = unwrap(node);
  if (inner?.type !== 'Literal') return undefined;
  const value = inner['value'];
  return typeof value === 'string' ? value : undefined;
}

/**
 * A list of string literals, however it was written where the call site reads it.
 *
 * `['limit']`, `IGNORE_KEYS`, `[...TOP_LEVEL, ...NOTES]`. `undefined` means the
 * list is one this rule cannot read, which is failed rather than skipped: a
 * `known` list nothing checked is the hole this whole file exists to close.
 */
function stringsOf(node: unknown, consts: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const inner = unwrap(node);
  if (inner === undefined) return undefined;

  if (inner.type === 'Identifier') {
    const found = consts.get(String(inner['name']));
    return found === undefined ? undefined : [...found];
  }
  if (inner.type !== 'ArrayExpression') return undefined;

  const out: string[] = [];
  for (const element of (inner['elements'] as readonly unknown[]) ?? []) {
    if (element === null) return undefined;
    const entry = element as Node;
    if (entry.type === 'SpreadElement') {
      const spread = stringsOf(entry['argument'], consts);
      if (spread === undefined) return undefined;
      out.push(...spread);
      continue;
    }
    const text = literal(entry);
    if (text === undefined) return undefined;
    out.push(text);
  }
  return out;
}

interface KeyList {
  /** The file and line the list is written at, for a message that points somewhere. */
  readonly where: string;
  readonly keys: readonly string[];
}

interface ParserReading {
  readonly objects: readonly KeyList[];
  readonly kinds: readonly KeyList[];
}

function readParsers(): ParserReading {
  const files = readdirSync(PARSERS)
    .filter((name) => /^config.*\.ts$/.test(name) && !name.includes('.test.'))
    .map((name) => join(PARSERS, name));

  const objects: KeyList[] = [];
  const kinds: KeyList[] = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const { program, errors } = parseSync(file, text);
    // A file this rule cannot read is a file whose keys it cannot vouch for.
    if (errors.length > 0) throw new Error(`${file} could not be parsed: ${errors[0]!.message}`);

    const consts = new Map<string, readonly string[]>();
    walk(program, (node) => {
      if (node.type !== 'VariableDeclarator') return;
      const id = node['id'] as Node | undefined;
      if (id?.type !== 'Identifier') return;
      const values = stringsOf(node['init'], consts);
      if (values !== undefined) consts.set(String(id['name']), values);
    });

    const at = (node: Node): string =>
      `${file.slice(ROOT.length + 1)}:${text.slice(0, Number(node['start'])).split('\n').length}`;

    walk(program, (node) => {
      if (node.type !== 'CallExpression') return;
      const callee = node['callee'] as Node | undefined;
      if (callee?.type !== 'Identifier') return;
      const name = String(callee['name']);
      if (name !== 'object' && name !== 'kindOf') return;

      const argument = (node['arguments'] as readonly unknown[])[2];
      const keys = stringsOf(argument, consts);
      const where = at(node);
      if (keys === undefined) {
        throw new Error(
          `${where}: the \`known\` list handed to \`${name}\` is not a list of string ` +
            'literals this rule can read, so nothing holds the schema to it',
        );
      }
      (name === 'object' ? objects : kinds).push({ where, keys });
    });
  }

  return { objects, kinds };
}

type Schema = Record<string, unknown>;

interface SchemaReading {
  /** Every `additionalProperties: false` object, by the keys it accepts. */
  readonly objects: readonly KeyList[];
  /** The `kind` values each `oneOf` chooses between. */
  readonly discriminators: readonly KeyList[];
  /** Properties that carry neither a description nor a `$ref` to one. */
  readonly mute: readonly string[];
}

function readSchema(): SchemaReading {
  const root = JSON.parse(readFileSync(SCHEMA, 'utf8')) as Schema;
  const objects: KeyList[] = [];
  const discriminators: KeyList[] = [];
  const mute: string[] = [];

  const visit = (node: unknown, where: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${where}/${index}`));
      return;
    }
    const schema = node as Schema;

    const properties = schema['properties'] as Schema | undefined;
    if (properties !== undefined && schema['additionalProperties'] === false) {
      objects.push({ where, keys: Object.keys(properties) });
      for (const [key, value] of Object.entries(properties)) {
        const property = value as Schema;
        const described =
          typeof property['description'] === 'string' && property['description'].length > 0;
        // A property whose whole body is a `$ref` says what it is by pointing at
        // a definition that already does, and repeating the sentence there is
        // how the two come to disagree.
        const referred = typeof property['$ref'] === 'string';
        // A `const` on its own is its own sentence: the key may be that word and
        // nothing else, and the branch it discriminates carries the prose.
        const pinned = property['const'] !== undefined && Object.keys(property).length === 1;
        if (!described && !referred && !pinned) mute.push(`${where}/properties/${key}`);
      }
    }

    const branches = schema['oneOf'];
    if (Array.isArray(branches)) {
      const values = branches
        .map((branch) => resolveKind(root, branch))
        .filter((value): value is string => value !== undefined);
      if (values.length === branches.length && values.length > 0) {
        discriminators.push({ where: `${where}/oneOf`, keys: values });
      }
    }

    for (const [key, value] of Object.entries(schema)) visit(value, `${where}/${key}`);
  };

  visit(root, '#');
  return { objects, discriminators, mute };
}

/** The `kind` a branch of a `oneOf` pins, following one `$ref` to find it. */
function resolveKind(root: Schema, branch: unknown): string | undefined {
  if (branch === null || typeof branch !== 'object') return undefined;
  let schema = branch as Schema;

  const reference = schema['$ref'];
  if (typeof reference === 'string') {
    let current: unknown = root;
    for (const segment of reference.replace(/^#\/?/, '').split('/').filter(Boolean)) {
      current = (current as Schema | undefined)?.[segment];
    }
    if (current === null || typeof current !== 'object') return undefined;
    schema = current as Schema;
  }

  const kind = (schema['properties'] as Schema | undefined)?.['kind'] as Schema | undefined;
  const value = kind?.['const'];
  return typeof value === 'string' ? value : undefined;
}

/** A key list as one comparable line, order-insensitive because a key set is. */
function signature(keys: readonly string[]): string {
  return [...keys].sort().join(', ');
}

const PARSED = readParsers();
const SCHEMED = readSchema();

describe('the config schema and the parsers that refuse a config', () => {
  it('reads both sides, so this rule cannot pass by finding nothing', () => {
    expect(PARSED.objects.length).toBeGreaterThan(15);
    expect(PARSED.kinds.length).toBeGreaterThan(2);
    expect(SCHEMED.objects.length).toBeGreaterThan(15);
  });

  it('describes every object the parsers accept, and no object they would refuse', () => {
    const fromSource = [...PARSED.objects.map(({ keys }) => keys), ...HAND_READ].map(signature).sort();
    const fromSchema = SCHEMED.objects.map(({ keys }) => signature(keys)).sort();

    const missing = difference(fromSource, fromSchema);
    const extra = difference(fromSchema, fromSource);

    expect(
      [
        ...missing.map((line) => {
          const source = PARSED.objects.find(({ keys }) => signature(keys) === line);
          return `  no schema entry accepts { ${line} }, refused at ${source?.where}`;
        }),
        ...extra.map((line) => `  the schema accepts { ${line} } and no parser does`),
      ].join('\n'),
    ).toBe('');
  });

  it('lists the same kinds the parsers choose between', () => {
    const available = SCHEMED.discriminators.map(({ keys }) => signature(keys));

    for (const { where, keys } of PARSED.kinds) {
      expect(
        available,
        `${where} accepts the kinds { ${signature(keys)} } and no \`oneOf\` in the schema offers them`,
      ).toContain(signature(keys));
    }
  });

  it('names the profiles core defines, since the parser holds no list of its own', () => {
    const file = join(ROOT, 'packages/core/src/format/profile.ts');
    const text = readFileSync(file, 'utf8');
    const { program } = parseSync(file, text);

    const declared: string[] = [];
    walk(program, (node) => {
      if (node.type !== 'TSTypeAliasDeclaration') return;
      if (String((node['id'] as Node | undefined)?.['name']) !== 'ProfileId') return;
      walk(node['typeAnnotation'], (inner) => {
        if (inner.type !== 'TSLiteralType') return;
        const value = literal(inner['literal']);
        if (value !== undefined) declared.push(value);
      });
    });

    expect(declared.length).toBeGreaterThan(1);

    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as Schema;
    const profile = (schema['properties'] as Schema)['profile'] as Schema;
    expect(
      signature(profile['enum'] as readonly string[]),
      'the schema offers profiles `core` does not define, or is missing one it gained',
    ).toBe(signature(declared));
  });

  it('says what every key is for', () => {
    // The schema is read by a person in an editor before it is read by anything
    // else, and a completion with no sentence behind it sends them back to the
    // source — which is the trip this file exists to save.
    expect(SCHEMED.mute).toEqual([]);
  });
});

/** Entries of `left` that `right` has no copy of, counting duplicates. */
function difference(left: readonly string[], right: readonly string[]): string[] {
  const remaining = [...right];
  const out: string[] = [];
  for (const entry of left) {
    const index = remaining.indexOf(entry);
    if (index === -1) out.push(entry);
    else remaining.splice(index, 1);
  }
  return out;
}
