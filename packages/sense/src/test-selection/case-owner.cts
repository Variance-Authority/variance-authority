/**
 * Who a case frame belongs to: one case's coordinate, packed into the string a
 * journal frame names itself with, and the fields that follow it.
 *
 * `journal-format.cts` owns the frame and treats this string as its first field
 * and nothing more; this file owns what the string holds. `native/src/case_owner.rs`
 * reads the same fields back in the fold.
 *
 * CommonJS for the reason `journal-format.cts` is: both writers are inside
 * somebody else's sandbox — Jest's setup file, and the module this package
 * generates for Vitest — where nothing is transformed. It requires nothing, so
 * a test can load it from source as it loads the codec.
 */

/** What a case frame calls the bucket no case owns. */
const AMBIENT = '';

/**
 * One case's coordinate, packed into the one string a journal frame names
 * itself with.
 *
 * A frame's first field is *who this journal belongs to*. For the file-level
 * seam that is a path; a case is the same fact spelled longer, so the frame
 * format is untouched and a per-case journal costs exactly what the measured
 * varint path already costs. NUL is the separator because it is the one byte a
 * file path and a test name cannot contain.
 */
function packCase(file: string, name: string, id: string, project?: string, limit?: number): string {
  const packed = `${file}\u0000${name}\u0000${id}`;
  const named = project === undefined || project === '' ? packed : withField(packed, PROJECT, project);
  return limit === undefined ? named : withField(named, LIMIT, String(limit));
}

/**
 * The fields after the coordinate, by position.
 *
 * Each is set by its index, never appended, so a writer that knows only some
 * of them leaves the others empty and every reader finds each where it looks.
 * The JVM agent writes a part owner as `\0\0\0\0<journey>` and relies on it.
 */
const SETTLED = 3;
const JOURNEY = 4;

/**
 * A packed case coordinate carrying what the case heard, as its sixth field.
 *
 * The field is always JSON, `{"said": […], "read": […], "misused": […]}`, each
 * facet a list of what `case-preconditions.cts` records: an empty facet is a
 * case that said, or read, nothing under a recorder that was listening; a facet
 * absent, or the field empty or missing, is one nobody listened to, which a
 * reader may not take for a case that said or read nothing.
 */
const HEARD = 5;

function packHeard(
  packed: string,
  heard: { readonly said: readonly unknown[]; readonly read?: readonly unknown[]; readonly misused?: readonly unknown[] },
): string {
  const { said, read, misused } = heard;
  return withField(packed, HEARD, JSON.stringify({
    said,
    ...(read === undefined ? {} : { read }),
    ...(misused === undefined ? {} : { misused }),
  }));
}

/** A frame owner's sixth field, as the realm wrote it; absent where its writer never listened. */
function heardField(packed: string): string | undefined {
  const field = packed.split('\u0000')[HEARD];
  return field === undefined || field === '' ? undefined : field;
}

/**
 * The project that ran the case — Vitest's, Jest's or Playwright's name for one
 * configured run of a test file. Absent when the run names none, so a case of a
 * single unnamed project packs as it always has.
 */
const PROJECT = 6;

/**
 * The milliseconds the case ran under, as its runner set them. Absent when the
 * harness could not read one, which is not a case without a limit.
 */
const LIMIT = 7;

/**
 * The case's statement times, as `<line> <microseconds>` pairs one after
 * another: every line of the test file the case cut at, in the order it first
 * reached them, and the whole microseconds it held. Absent where the file was
 * not cut, which is not a case that took no time.
 */
const TIMES = 8;

/**
 * What surrounded each of those statements as it ended, as four words per
 * statement in the order of {@link TIMES}: the load average in hundredths, the
 * RSS and the free memory in whole MiB, and the nodes it added to the page,
 * each `-` where the realm could not read it. Absent where no figure was read.
 */
const AROUND = 9;

/** The figures of {@link AROUND}, in its order. */
const FIGURES = ['load', 'rss', 'free', 'added'] as const;

interface Time {
  readonly line: number;
  readonly time: number;
  readonly load?: number;
  readonly rss?: number;
  readonly free?: number;
  readonly added?: number;
}

function withField(packed: string, at: number, value: string): string {
  const fields = packed.split('\u0000');
  while (fields.length <= at) fields.push('');
  fields[at] = value;
  return fields.join('\u0000');
}

/**
 * How a frame says whether its case's journey ended.
 *
 * A field of its own rather than a second coordinate: the case is the same case
 * whichever way it settled, so the fields a reader joins frames on are
 * untouched. A frame written before the case settled, or by a writer that
 * cannot see settling, leaves it empty, and says nothing.
 */
const FINISHED = 'finished';
const STOPPED = 'stopped';

function settledCase(packed: string, stopped: boolean): string {
  return withField(packed, SETTLED, stopped ? STOPPED : FINISHED);
}

/** `times` as the case's fields: the load average of each in hundredths, as the collector reads it. */
function timesCase(packed: string, times: readonly Time[]): string {
  const timed = withField(packed, TIMES, times.map(({ line, time }) => `${line} ${time}`).join(' '));
  if (!times.some((time) => FIGURES.some((figure) => time[figure] !== undefined))) return timed;
  return withField(timed, AROUND, times.flatMap((time) => FIGURES.map((figure) => time[figure] ?? '-')).join(' '));
}

/** The times of the fields, each load average as the reading itself rather than its hundredths. */
function timesOf(field: string | undefined, around: string | undefined): Time[] | undefined {
  if (field === undefined || field === '') return undefined;
  const words = field.split(' ').map(Number);
  const figures = around === undefined || around === '' ? [] : around.split(' ');
  const times: Time[] = [];
  for (let at = 0; at + 1 < words.length; at += 2) {
    const read = figures.slice(at * 2, at * 2 + FIGURES.length);
    const held = FIGURES.flatMap((figure, of) => {
      const word = read[of];
      if (word === undefined || word === '-') return [];
      return [[figure, figure === 'load' ? Number(word) / 100 : Number(word)] as const];
    });
    times.push({ line: words[at]!, time: words[at + 1]!, ...Object.fromEntries(held) });
  }
  return times;
}

function unpackCase(packed: string): { file: string; name: string; id: string; project?: string; limit?: number; times?: Time[]; stopped?: boolean } {
  const parts = packed.split('\u0000');
  const project = parts[PROJECT];
  const limit = parts[LIMIT];
  const times = timesOf(parts[TIMES], parts[AROUND]);
  const coordinate = {
    file: parts[0] ?? packed,
    name: parts[1] ?? AMBIENT,
    id: parts[2] ?? AMBIENT,
    ...(project === undefined || project === '' ? {} : { project }),
    ...(limit === undefined || limit === '' ? {} : { limit: Number(limit) }),
    ...(times === undefined ? {} : { times }),
  };
  if (parts[SETTLED] === STOPPED) return { ...coordinate, stopped: true };
  if (parts[SETTLED] === FINISHED) return { ...coordinate, stopped: false };
  return coordinate;
}

/**
 * A coordinate that handed out a journey id.
 *
 * The fold reads it to join what ran beyond a fence under that id — a part
 * frame is owned by `\0\0\0\0<journey>`, no case of its own — back to the case
 * that sent it.
 */
function packJourney(packed: string, journey: string): string {
  return withField(packed, JOURNEY, journey);
}

/** The journey a frame owner carries; empty when it carries none. */
function journeyOf(packed: string): string {
  return packed.split('\u0000')[JOURNEY] ?? '';
}

export = { packCase, settledCase, timesCase, unpackCase, packJourney, journeyOf, packHeard, heardField };
