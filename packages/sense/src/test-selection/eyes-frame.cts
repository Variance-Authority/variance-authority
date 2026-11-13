/**
 * What a case's Eyes journal travels as, from the worker to the fold.
 *
 * A journal is closed in the test's `afterEach`, after the runner's case scope
 * has already closed around the body: Vitest wraps the test function and
 * nothing else, and Jest's `test_fn_start` is the body too. So the scope keeps a
 * second, longer bracket beside the one it logs crossings under, *attending*:
 * opened when the runner starts an attempt, named by the case the attempt
 * enters, and closed once the attempt's hooks are done. A journal handed over
 * inside it is written under that case and the attempt the scope counted.
 *
 * Each journal is its own frame in the file's `.vac`, beside the case frames,
 * so it rides the same transport and lands in the same write. A frame names its
 * case by the packed coordinate the case frames use, and the fold joins the two
 * by it. A frame with no journal says the case opened one: a case that watched
 * and handed nothing over is told apart from a case that never watched.
 *
 * The frame is JSON behind its own magic: a journal is Eyes' to read, and a
 * handful per case is nothing beside the case's crossings.
 *
 * CommonJS for the same reason as `journal-format.cts`: Jest evaluates the
 * collector inside the sandbox, from `node_modules`, untransformed.
 */

/** `VAEYS` and a format version. A case frame opens with `VAJRN` instead. */
const MAGIC = [0x56, 0x41, 0x45, 0x59, 0x53, 0x00, 0x00, 0x01];

/** One attempt's word from Eyes, under the case coordinate the worker packed. */
interface EyesFrame {
  /** The packed case coordinate, as `packCase` spells it. */
  readonly case: string;
  /** Counted from 1, per case, in the worker that ran it. */
  readonly attempt: number;
  /** The journal as Eyes handed it over; absent, the case opened one. */
  readonly journal?: Readonly<Record<string, unknown>>;
}

function encodeEyesFrame(frame: EyesFrame): Uint8Array {
  const body = Buffer.from(JSON.stringify(frame), 'utf8');
  const out = new Uint8Array(MAGIC.length + body.length);
  out.set(MAGIC, 0);
  out.set(body, MAGIC.length);
  return out;
}

/** The frame, or `undefined` when `bytes` is not an eyes frame. */
function decodeEyesFrame(bytes: Uint8Array): EyesFrame | undefined {
  if (bytes.length < MAGIC.length) return undefined;
  for (let at = 0; at < MAGIC.length; at += 1) if (bytes[at] !== MAGIC[at]) return undefined;
  const parsed = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset + MAGIC.length, bytes.length - MAGIC.length)
    .toString('utf8')) as Partial<EyesFrame> | null;
  if (parsed === null || typeof parsed.case !== 'string' || typeof parsed.attempt !== 'number' ||
    (parsed.journal !== undefined && (typeof parsed.journal !== 'object' || parsed.journal === null))) {
    throw new Error('not a variance-authority eyes frame');
  }
  return parsed as EyesFrame;
}

/** What a collector's case scope adds for Eyes, and the two calls it owes it. */
interface Attending {
  /** Handed to Eyes under the case scope's symbol. */
  readonly scope: {
    readonly root: string;
    readonly eyes: (journal: Readonly<Record<string, unknown>>) => boolean;
    readonly watch: () => void;
    /** The runner starts an attempt: its hooks and its body follow. */
    readonly begin: () => void;
    /** The attempt's hooks are done. */
    readonly leave: () => void;
  };
  /** A case's body is entered, under `key`. */
  readonly entered: (key: string) => void;
}

/**
 * The attending bracket for one collector.
 *
 * @param running The case whose body is running now, or `undefined` outside
 * every body; `null` when the collector can no longer tell cases apart.
 * @param push Where a frame goes, beside the collector's case frames.
 */
function attending(
  root: string,
  running: () => string | undefined | null,
  push: (frame: Uint8Array) => void,
): Attending {
  const attempts = new Map<string, number>();
  let trying = false;
  // The case the current attempt entered, kept until its hooks are done.
  let attended: string | undefined;
  // A journal opened in `beforeEach`, before the attempt has named its case.
  let watching = false;
  const write = (key: string, journal?: Readonly<Record<string, unknown>>): void => {
    push(encodeEyesFrame({ case: key, attempt: attempts.get(key) ?? 1, ...(journal === undefined ? {} : { journal }) }));
  };
  const target = (): string | undefined | null => {
    const now = running();
    return now === undefined ? attended : now;
  };
  return {
    scope: {
      root,
      eyes(journal) {
        const key = target();
        if (key === undefined || key === null) return false;
        write(key, journal);
        return true;
      },
      watch() {
        const key = target();
        if (key === null) return;
        if (key !== undefined) write(key);
        else if (trying) watching = true;
      },
      begin() {
        trying = true;
        attended = undefined;
        watching = false;
      },
      leave() {
        trying = false;
        attended = undefined;
        watching = false;
      },
    },
    entered(key) {
      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      if (!trying) return;
      attended = key;
      if (!watching) return;
      watching = false;
      write(key);
    },
  };
}

export = { encodeEyesFrame, decodeEyesFrame, attending };
