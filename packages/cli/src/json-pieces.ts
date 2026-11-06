/**
 * `JSON.stringify(value, null, 2)` in pieces whose joined text is the same,
 * so a large answer is written as it serializes rather than held whole as one
 * string beside the value it spells.
 *
 * The value and the lists and objects it holds are walked `walked` levels
 * deep, the answer and its lists unless given; whatever lies below is one
 * piece each, stringified as a whole. The same text is promised
 * for plain data only — objects, lists, strings, numbers, booleans and
 * `null`, which is all a distillation holds. A boxed primitive, a `toJSON`
 * on the value itself that returns `undefined`, or one whose result has a
 * `toJSON` of its own may write other text.
 */
export function* jsonPieces(value: object, walked = 2): Generator<string, void, undefined> {
  yield* pieces(prepared(value, ''), '', 0, walked);
}

function* pieces(value: unknown, indent: string, depth: number, walked: number): Generator<string, void, undefined> {
  if (depth >= walked || value === null || typeof value !== 'object') {
    yield JSON.stringify(value, null, 2).replaceAll('\n', `\n${indent}`);
    return;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return yield '[]';
    for (let at = 0; at < value.length; at += 1) {
      yield `${at === 0 ? '[' : ','}\n${inner}`;
      const child = prepared(value[at], String(at));
      if (omitted(child)) yield 'null';
      else yield* pieces(child, inner, depth + 1, walked);
    }
    return yield `\n${indent}]`;
  }
  let first = true;
  for (const [key, held] of Object.entries(value)) {
    const child = prepared(held, key);
    if (omitted(child)) continue;
    yield `${first ? '{' : ','}\n${inner}${JSON.stringify(key)}: `;
    first = false;
    yield* pieces(child, inner, depth + 1, walked);
  }
  yield first ? '{}' : `\n${indent}}`;
}

/** The value `JSON.stringify` writes for `value` under `key`. */
function prepared(value: unknown, key: string): unknown {
  const toJSON = value !== null && typeof value === 'object' ? (value as { toJSON?: unknown }).toJSON : undefined;
  return typeof toJSON === 'function' ? toJSON.call(value, key) : value;
}

/** What `JSON.stringify` leaves out of an object, and writes as `null` in a list. */
function omitted(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

/** How much text is gathered before it is written: a write a piece would cost more than the text. */
const WRITTEN = 1 << 16;

/**
 * Write pieces of text to `out` a batch at a time, waiting after each batch
 * until the reader has taken it, so what is held follows the batch and not
 * the whole answer. A reader that has gone is written nothing more, and the
 * rest of the pieces are not made.
 */
export async function writePieces(
  pieces: Iterable<string>,
  streams: { out(text: string): void; drained?(): Promise<boolean> },
): Promise<void> {
  let batch = '';
  for (const piece of pieces) {
    batch += piece;
    if (batch.length < WRITTEN) continue;
    streams.out(batch);
    batch = '';
    if ((await streams.drained?.()) === false) return;
  }
  if (batch !== '') streams.out(batch);
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const COLON = 0x3a;
const OPEN_LIST = 0x5b;
const CLOSE_LIST = 0x5d;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;

/** JSON's whitespace: space, tab, line feed and carriage return. */
function blank(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

/**
 * The JSON object `bytes` spell, read without spelling it as one string: each
 * member is parsed alone, and a member whose value is a list is parsed an
 * element at a time, so the object may weigh more than V8 holds in one string
 * as long as no one element does. The reverse of {@link jsonPieces}. A list is
 * split in the object's own members only; an element past the limit throws
 * `ERR_STRING_TOO_LONG`. It reads what `jsonPieces` writes; it is not a
 * validator, and a malformed separator between members may pass unremarked.
 */
export function jsonOfBytes(bytes: Buffer): Record<string, unknown> {
  const text = (from: number, to: number): string => bytes.toString('utf8', from, to);
  const value: Record<string, unknown> = {};
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let member = -1;
  let colon = -1;
  let valueSeen = false;
  let list: unknown[] | undefined;
  let element = -1;
  let finished = false;
  const finish = (at: number): void => {
    if (colon < 0) return;
    const key = JSON.parse(text(member, colon)) as string;
    Object.defineProperty(value, key, { value: list ?? JSON.parse(text(colon + 1, at)), enumerable: true, writable: true, configurable: true });
    colon = -1;
    valueSeen = false;
    list = undefined;
  };
  const take = (at: number): void => {
    let from = element;
    while (from < at && blank(bytes[from]!)) from += 1;
    if (from < at) list!.push(JSON.parse(text(from, at)));
  };
  for (let at = 0; at < bytes.length; at += 1) {
    const byte = bytes[at]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (byte === BACKSLASH) escaped = true;
      else if (byte === QUOTE) quoted = false;
      continue;
    }
    if (blank(byte)) continue;
    if (finished) throw new SyntaxError(`Unexpected text after the JSON object at byte ${at}`);
    if (depth === 0 && byte !== OPEN_OBJECT) throw new SyntaxError(`Expected a JSON object at byte ${at}`);
    if (depth === 1 && colon >= 0 && !valueSeen) {
      valueSeen = true;
      if (byte === OPEN_LIST) {
        list = [];
        element = at + 1;
        depth += 1;
        continue;
      }
    }
    if (byte === QUOTE) quoted = true;
    else if (byte === OPEN_LIST || byte === OPEN_OBJECT) {
      depth += 1;
      if (depth === 1) member = at + 1;
    } else if (byte === CLOSE_LIST || byte === CLOSE_OBJECT) {
      if (depth === 2 && list !== undefined && byte === CLOSE_LIST) {
        take(at);
        element = -1;
      }
      depth -= 1;
      if (depth === 0) {
        finish(at);
        finished = true;
      }
    } else if (byte === COLON && depth === 1 && colon < 0) colon = at;
    else if (byte === COMMA && depth === 1) {
      finish(at);
      member = at + 1;
    } else if (byte === COMMA && depth === 2 && list !== undefined && element >= 0) {
      take(at);
      element = at + 1;
    }
  }
  if (!finished) throw new SyntaxError('The JSON object ends before it closes');
  return value;
}
