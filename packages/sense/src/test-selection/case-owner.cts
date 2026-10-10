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
function packCase(file: string, name: string, id: string, project?: string): string {
  const packed = `${file}\u0000${name}\u0000${id}`;
  return project === undefined || project === '' ? packed : withField(packed, PROJECT, project);
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
// Field 5 is what the case said, set by `case-preconditions.cts`.
/**
 * The project that ran the case — Vitest's, Jest's or Playwright's name for one
 * configured run of a test file. Absent when the run names none, so a case of a
 * single unnamed project packs as it always has.
 */
const PROJECT = 6;

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

function unpackCase(packed: string): { file: string; name: string; id: string; project?: string; stopped?: boolean } {
  const parts = packed.split('\u0000');
  const project = parts[PROJECT];
  const coordinate = {
    file: parts[0] ?? packed,
    name: parts[1] ?? AMBIENT,
    id: parts[2] ?? AMBIENT,
    ...(project === undefined || project === '' ? {} : { project }),
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

export = { packCase, settledCase, unpackCase, packJourney, journeyOf };
