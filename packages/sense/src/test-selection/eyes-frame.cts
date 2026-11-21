/**
 * What a case's Eyes journal, and each check it entered, travel as, from the
 * worker to the fold.
 *
 * A journal is closed in the test's `afterEach`, after the runner's case scope
 * has closed around the body, so the scope keeps a longer bracket, *attending*:
 * opened when the runner starts an attempt, named by the case the attempt
 * enters, and closed once its hooks are done. What is handed over inside it is
 * written under that case and the attempt the scope counted.
 *
 * Each is a JSON frame behind its own magic in the file's `.vac`, beside the
 * case frames and joined to them by the same packed coordinate. CommonJS for
 * the same reason as `journal-format.cts`: Jest evaluates the collector inside
 * the sandbox, from `node_modules`, untransformed.
 */

/** `VAEYS` and a format version. A case frame opens with `VAJRN` instead. */
const MAGIC = [0x56, 0x41, 0x45, 0x59, 0x53, 0x00, 0x00, 0x01];

/** One attempt's word from Eyes, under the case coordinate the worker packed. */
interface EyesFrame {
  /** The packed case coordinate, as `packCase` spells it. */
  readonly case: string;
  /** Counted from 1, per case, in the worker that ran it. */
  readonly attempt: number;
  /**
   * The journal as Eyes handed it over; absent with no `check`, the case opened
   * one: a case that watched and handed nothing over is told apart from one that
   * never watched.
   */
  readonly journal?: Readonly<Record<string, unknown>>;
  /**
   * The id of a check the attempt entered (`checked.ts`); a frame names a check
   * or a journal, never both. Kept under the attempt that entered it, so a failed
   * attempt never lends its checks to the retry, and kept with or without Eyes.
   */
  readonly check?: string;
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
    (parsed.journal !== undefined && (typeof parsed.journal !== 'object' || parsed.journal === null)) ||
    (parsed.check !== undefined && (typeof parsed.check !== 'string' || parsed.journal !== undefined))) {
    throw new Error('not a variance-authority eyes frame');
  }
  return parsed as EyesFrame;
}

/** What a collector's case scope adds for Eyes and for `checked`, and the two calls it owes them. */
interface Attending {
  /** Handed to Eyes and `checked` under the case scope's symbol; Eyes' members only with a checkout. */
  readonly scope: {
    readonly root?: string;
    readonly eyes?: (journal: Readonly<Record<string, unknown>>) => boolean;
    readonly watch?: () => void;
    /** The attempt entered the check `id`; `false` where no case runs. */
    readonly checked: (id: string) => boolean;
    /**
     * The runner starts an attempt, its hooks and its body to follow, and says
     * which of the case's attempts it is: one whose `beforeEach` fails never
     * enters the body, and is an attempt all the same.
     */
    readonly begin: (attempt?: number) => void;
    /** The attempt's hooks are done. */
    readonly leave: () => void;
  };
  /**
   * A case's body is entered, under `key`, as the attempt `begin` named; as the
   * case's next where no runner named one.
   */
  readonly entered: (key: string) => void;
}

/**
 * The attending bracket for one collector.
 *
 * @param root The checkout Eyes spells a journal's paths against; absent, Eyes
 * finds no scope to hand one to, and checks are still kept.
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
  // Which of its case's attempts the runner said this one is.
  let named: number | undefined;
  // The case the current attempt entered, kept until its hooks are done.
  let attended: string | undefined;
  // A journal opened in `beforeEach`, before the attempt has named its case.
  let watching = false;
  const write = (key: string, word: Pick<EyesFrame, 'journal' | 'check'> = {}): void => {
    push(encodeEyesFrame({ case: key, attempt: attempts.get(key) ?? 1, ...word }));
  };
  const target = (): string | undefined | null => {
    const now = running();
    return now === undefined ? attended : now;
  };
  const eyes = (at: string) => ({
    root: at,
    eyes(journal: Readonly<Record<string, unknown>>): boolean {
      const key = target();
      if (key === undefined || key === null) return false;
      write(key, { journal });
      return true;
    },
    watch(): void {
      const key = target();
      if (key === null) return;
      if (key !== undefined) write(key);
      else if (trying) watching = true;
    },
  });
  return {
    scope: {
      ...(root === undefined ? {} : eyes(root)),
      checked(check) {
        const key = target();
        if (key === undefined || key === null) return false;
        write(key, { check });
        return true;
      },
      begin(attempt) {
        trying = true;
        named = attempt;
        attended = undefined;
        watching = false;
      },
      leave() {
        trying = false;
        named = undefined;
        attended = undefined;
        watching = false;
      },
    },
    entered(key) {
      attempts.set(key, named ?? (attempts.get(key) ?? 0) + 1);
      if (!trying) return;
      attended = key;
      if (!watching) return;
      watching = false;
      write(key);
    },
  };
}

export = { encodeEyesFrame, decodeEyesFrame, attending };
