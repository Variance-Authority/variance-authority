/**
 * `JSON.stringify(value, null, 2)` in pieces whose joined text is the same,
 * so a large answer is written as it is read rather than held whole as one
 * string beside the value it spells.
 *
 * The value and the lists and objects it holds are walked; whatever those
 * hold is one piece each, stringified as a whole. A `toJSON` below that depth
 * is called by `JSON.stringify`, with the key it is given there.
 */
export function* jsonPieces(value: object): Generator<string, void, undefined> {
  yield* pieces(prepared(value, ''), '', 0);
}

/** How deep the walk goes before a value is one piece: the answer, then its lists. */
const WALKED = 2;

function* pieces(value: unknown, indent: string, depth: number): Generator<string, void, undefined> {
  if (depth >= WALKED || value === null || typeof value !== 'object') {
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
      else yield* pieces(child, inner, depth + 1);
    }
    return yield `\n${indent}]`;
  }
  let first = true;
  for (const [key, held] of Object.entries(value)) {
    const child = prepared(held, key);
    if (omitted(child)) continue;
    yield `${first ? '{' : ','}\n${inner}${JSON.stringify(key)}: `;
    first = false;
    yield* pieces(child, inner, depth + 1);
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
 * the whole answer.
 */
export async function writePieces(
  pieces: Iterable<string>,
  streams: { out(text: string): void; drained?(): Promise<void> },
): Promise<void> {
  let batch = '';
  for (const piece of pieces) {
    batch += piece;
    if (batch.length < WRITTEN) continue;
    streams.out(batch);
    batch = '';
    await streams.drained?.();
  }
  if (batch !== '') streams.out(batch);
}
