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
  /** The journal as Eyes handed it over; absent on a frame with no `ended`, the case opened one. */
  readonly journal?: Readonly<Record<string, unknown>>;
  /** How the attempt's body settled; the frame is then no word from Eyes. Written only for a case entered more than once. */
  readonly ended?: 'passed' | 'failed';
  /** From the body's entry to its settling, in milliseconds. */
  readonly duration?: number;
  /** What a failed body threw: its message, cut at `MESSAGE` characters. */
  readonly message?: string;
  /** And its stack, cut at `STACK` characters, for the fold to find the checkout's frame in. */
  readonly stack?: string;
}

/** Enough to name a failure, and its nearest frames, without carrying a diff of two large values. */
const MESSAGE = 2_000;
const STACK = 4_000;

/** Read once, so a case that fakes its timers does not fake how long it ran. */
const clock = typeof performance === 'undefined' ? undefined : performance.now.bind(performance);

/** `value[name]` when it is text, cut at `cap`; a thrown value is anything, and reading it may throw. */
function textOf(value: unknown, name: 'message' | 'stack', cap: number): string | undefined {
  try {
    const text = typeof value === 'string' && name === 'message' ? value : (value as Record<string, unknown> | null | undefined)?.[name];
    return typeof text === 'string' ? text.slice(0, cap) : undefined;
  } catch {
    return undefined;
  }
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
  /** Handed to Eyes under the case scope's symbol; `undefined` when the collector was given no checkout. */
  readonly scope: {
    readonly root: string;
    readonly eyes: (journal: Readonly<Record<string, unknown>>) => boolean;
    readonly watch: () => void;
    /** The runner starts an attempt: its hooks and its body follow. */
    readonly begin: () => void;
    /** The attempt's hooks are done. */
    readonly leave: () => void;
  } | undefined;
  /** A case's body is entered, under `key`. The answer is called once that body settles, with what it threw. */
  readonly entered: (key: string) => (threw: boolean, thrown?: unknown) => void;
}

/**
 * The attending bracket for one collector.
 *
 * @param root The checkout Eyes resolves its paths against; absent, Eyes is handed nothing.
 * @param running The case whose body is running now, or `undefined` outside
 * every body; `null` when the collector can no longer tell cases apart.
 * @param push Where a frame goes, beside the collector's case frames.
 */
function attending(
  root: string | undefined,
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
  // How each case's first attempt ended, held until a second one is entered.
  const first = new Map<string, EyesFrame>();
  const settled = (key: string, attempt: number, started: number | undefined) => (threw: boolean, thrown?: unknown): void => {
    const message = threw ? textOf(thrown, 'message', MESSAGE) : undefined;
    const stack = threw ? textOf(thrown, 'stack', STACK) : undefined;
    const frame: EyesFrame = {
      case: key,
      attempt,
      ended: threw ? 'failed' : 'passed',
      ...(started === undefined ? {} : { duration: Math.round(clock!() - started) }),
      ...(message === undefined ? {} : { message }),
      ...(stack === undefined ? {} : { stack }),
    };
    if (attempts.get(key)! > 1) push(encodeEyesFrame(frame));
    else first.set(key, frame);
  };
  const target = (): string | undefined | null => {
    const now = running();
    return now === undefined ? attended : now;
  };
  return {
    scope: root === undefined ? undefined : {
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
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      const held = first.get(key);
      if (held !== undefined) {
        first.delete(key);
        push(encodeEyesFrame(held));
      }
      const over = settled(key, attempt, clock?.());
      if (!trying) return over;
      attended = key;
      if (!watching) return over;
      watching = false;
      write(key);
      return over;
    },
  };
}

export = { encodeEyesFrame, decodeEyesFrame, attending };
