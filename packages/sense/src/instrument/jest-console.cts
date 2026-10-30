// compass: variance-authority.reach.story
/**
 * Where a story hears what a case printed through Jest's console.
 *
 * Jest names where a line was printed by counting a fixed number of frames up
 * from the function that writes it, which it finds by name at the time of the
 * call: the console's own `_addToBuffer` when it prints at once, its class's
 * `write` when it buffers. A wrapper around `log` adds a frame and is named
 * instead; one put under that name is the frame Jest counts from.
 */

type Written = (method: string, text: string) => void;

const WRITERS = Symbol.for('variance-authority.story.jest-writers');

interface JestConsole {
  _addToBuffer?: (type: string, message: string) => void;
  _buffer?: unknown[];
  _groupDepth?: number;
  constructor: {
    write?: (buffer: unknown[], type: string, message: string, stackLevel?: number) => unknown;
    [WRITERS]?: WeakMap<object, readonly [JestConsole, Written]>;
  };
}

/** Hand `written` every line `printer` writes, its method and formatted text, and say whether `printer` is Jest's. */
function noteWrites(printer: object, written: Written): boolean {
  const jest = printer as JestConsole;
  if (typeof jest._addToBuffer === 'function') {
    const original = jest._addToBuffer;
    jest._addToBuffer = function (type, message) {
      written(type, message);
      return original.call(this, type, message);
    };
    return true;
  }
  const kind = jest.constructor;
  if (!Array.isArray(jest._buffer) || typeof kind.write !== 'function') return false;
  // One class buffers for every test file a worker runs, so a line finds its file's console by its buffer.
  let writers = kind[WRITERS];
  if (writers === undefined) {
    const known = new WeakMap<object, readonly [JestConsole, Written]>();
    writers = known;
    Object.defineProperty(kind, WRITERS, { value: known });
    const original = kind.write;
    kind.write = function (buffer, type, message, stackLevel) {
      const writer = known.get(buffer);
      // A line written straight to the console's stream, a table or a trace, is no method's print.
      if (writer !== undefined && stackLevel !== undefined) writer[1](type, message.slice(2 * (writer[0]._groupDepth ?? 0)));
      return original.call(this, buffer, type, message, stackLevel);
    };
  }
  writers.set(jest._buffer, [jest, written]);
  return true;
}

export = { noteWrites };
