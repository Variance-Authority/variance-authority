// compass: variance-authority.review
/**
 * The deployment's `wrangler.jsonc`, read for what provisioning needs and
 * written back where provisioning learned something.
 *
 * Writes are targeted: the operator's comments, order and formatting survive,
 * because the file is theirs and checked in. A value the file does not have is
 * added; one it has is replaced in place.
 */

export interface Deployment {
  readonly name: string;
  /** Absent when the config names none; provisioning then asks the login. */
  readonly accountId?: string;
  readonly database: { readonly name: string; readonly id: string };
  readonly bucket: string;
  /** The custom domain the Worker is routed on, when it has one. */
  readonly host?: string;
}

interface Parsed {
  readonly name?: unknown;
  readonly account_id?: unknown;
  readonly d1_databases?: readonly { readonly binding?: unknown; readonly database_name?: unknown; readonly database_id?: unknown }[];
  readonly r2_buckets?: readonly { readonly binding?: unknown; readonly bucket_name?: unknown }[];
  readonly routes?: readonly { readonly pattern?: unknown; readonly custom_domain?: unknown }[];
}

/** What provisioning needs from the config, or why the config cannot answer. */
export function readDeployment(text: string): Deployment {
  const parsed = JSON.parse(stripJsonc(text)) as Parsed;
  const name = required(parsed.name, '`name`');
  const accountId = typeof parsed.account_id === 'string' && parsed.account_id !== '' ? parsed.account_id : undefined;
  const database = parsed.d1_databases?.find((each) => each.binding === 'DB');
  if (database === undefined) throw new Error('the config has no `d1_databases` entry bound as `DB`');
  const bucket = parsed.r2_buckets?.find((each) => each.binding === 'BUCKET');
  if (bucket === undefined) throw new Error('the config has no `r2_buckets` entry bound as `BUCKET`');
  const route = parsed.routes?.find((each) => each.custom_domain === true && typeof each.pattern === 'string');

  return {
    name,
    ...(accountId === undefined ? {} : { accountId }),
    database: {
      name: required(database.database_name, '`database_name` of `DB`'),
      id: typeof database.database_id === 'string' ? database.database_id : '',
    },
    bucket: required(bucket.bucket_name, '`bucket_name` of `BUCKET`'),
    ...(route === undefined ? {} : { host: route.pattern as string }),
  };
}

/** The config with `DB`'s `database_id` set to `id`. */
export function withDatabaseId(text: string, id: string): string {
  const entry = /("binding"\s*:\s*"DB"[^}]*?"database_id"\s*:\s*")[^"]*(")/;
  if (!entry.test(text)) throw new Error('the `DB` entry has no `database_id` to write');
  return text.replace(entry, `$1${id}$2`);
}

/** The config with a top-level `account_id`: an empty one filled, a missing one added after `name`. */
export function withAccountId(text: string, id: string): string {
  const existing = /("account_id"\s*:\s*)"[^"]*"/;
  if (existing.test(text)) return text.replace(existing, `$1${JSON.stringify(id)}`);
  const name = /("name"\s*:\s*"[^"]*"\s*,)(\s*)/;
  if (!name.test(text)) throw new Error('the config has no `name` to place `account_id` beside');
  return text.replace(name, (_, entry: string, space: string) => `${entry}${space}"account_id": ${JSON.stringify(id)},${space}`);
}

/** The config with `vars.<name>` set to `value`. */
export function withVariable(text: string, name: string, value: string): string {
  const quoted = JSON.stringify(value);
  const existing = new RegExp(`("vars"\\s*:\\s*\\{[^}]*?"${name}"\\s*:\\s*)"[^"]*"`);
  if (existing.test(text)) return text.replace(existing, `$1${quoted}`);

  const vars = /("vars"\s*:\s*\{)(\s*)/;
  if (vars.test(text)) {
    return text.replace(vars, (_, open: string, space: string) => {
      const separator = space.includes('\n') ? space : ' ';
      return `${open}${separator}"${name}": ${quoted},${separator}`;
    });
  }

  const open = text.indexOf('{');
  if (open === -1) throw new Error('the config is not an object');
  return `${text.slice(0, open + 1)}\n  "vars": { "${name}": ${quoted} },${text.slice(open + 1)}`;
}

function required(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`the config has no ${what}`);
  return value;
}

/** JSONC to JSON: comments dropped, trailing commas dropped, strings untouched. */
function stripJsonc(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"') {
      const end = endOfString(text, index);
      out += text.slice(index, end);
      index = end;
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      out += char;
      index += 1;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
  return index + 1;
}
