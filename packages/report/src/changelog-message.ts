import type { ChangelogEntry, ChangelogRecord } from './changelog.js';

/**
 * The record as a commit message, and back.
 *
 * Where baselines are files in the repository, the commit that updates them is
 * the only artifact guaranteed to still exist when somebody asks why. It already
 * has a place for an explanation, and every tool a reader has — `git log`,
 * `git blame`, a pull request page — already shows it. So the message *is* the
 * store, and this is its codec.
 *
 * ## Two audiences, two halves, one message
 *
 * The subject line and the table under it are for whoever scrolls `git log`. The
 * **trailers** are for the reader that comes back with a question. Asking one
 * string to be both readable and parseable is how a format acquires escaping
 * rules that a component named `Card: small` then breaks, so the halves are
 * separate and only one of them is parsed.
 *
 * That split is also what keeps the readable half short. It carries no field it
 * has to carry — the record is complete in the trailers either way — so it
 * carries the four things a person scanning a log is actually looking for, and a
 * change to what is *displayed* is never a change to what was *recorded*.
 *
 * ## Why the payload is opaque
 *
 * A trailer value is a single line of arbitrary text, and every field here is a
 * string somebody else chose: subject ids, component names, an intent sentence,
 * a file path. Base64url removes the entire question — no delimiter to collide
 * with, no colon to split on twice, nothing that can become shell or markdown
 * syntax on the way through a pull-request body.
 *
 * The `v1` prefix in front of it is what lets a later reader **refuse** rather
 * than half-understand. A commit written by a newer writer is named as such;
 * partly parsing it would answer a question about a change with a subset of what
 * that change was.
 *
 * ## What git does to this, and what it does not
 *
 * Trailers are repeated keys, one per entry, which git treats as ordered and
 * preserves. Values never contain a newline, so nothing ever needs unfolding.
 *
 * The parser scans the **whole message**, not the last paragraph. That deviates
 * from git's own trailer rules deliberately: a squash merge concatenates commit
 * bodies, so a baseline commit's trailers land mid-message and `%(trailers)`
 * finds nothing. A false positive is not reachable — a line that matches must
 * also decode as base64 and parse as a versioned record.
 *
 * What this cannot promise is append-only. `--amend` and `reword` rewrite a
 * message in place and nothing here observes it. That is a property of the
 * medium, stated rather than papered over: the trigger-backed guarantee belongs
 * to the review database, and a repository is a place where history is editable
 * by whoever can push.
 */

/** Head fields: which run, at which commit, and how it was accepted. */
const HEAD = 'Variance-Run';

/** One per change, repeated. */
const CHANGE = 'Variance-Change';

const VERSION = 'v1';

/** How many changes the prose names before it starts counting instead. */
const NAMED_IN_PROSE = 20;

export interface CommitMessageOptions {
  /** The subject line, in the operator's words. The record never invents one. */
  readonly message: string;
  readonly record: ChangelogRecord;
}

/**
 * Render the commit that carries a baseline update.
 *
 * The subject line is the operator's, unchanged. A command that rewrote it would
 * be overruling the one part of the message a project's own conventions govern —
 * and every repository with a commit-message convention has one.
 */
export function renderCommitMessage(options: CommitMessageOptions): string {
  const { record } = options;
  const head: Record<string, unknown> = { ...record, entries: undefined };

  return [
    options.message,
    '',
    ...changelogBody(record),
    '',
    `${HEAD}: ${VERSION} ${encode(head)}`,
    ...record.entries.map((entry) => `${CHANGE}: ${VERSION} ${encode(entry)}`),
    '',
  ].join('\n');
}

/**
 * The body, as lines somebody scans rather than sentences they read.
 *
 * Exported because a commit message is not the only place these lines belong.
 * An agent asking *what would this update record* before running `accept` has to
 * be answered in the same words the commit will carry, or the preview becomes a
 * second description of a baseline update — and the two would then be edited
 * separately until one of them was wrong.
 *
 * This lands in **every** baseline commit. That is the constraint the shape is
 * chosen for: a paragraph explaining what `--all` means is true, and by the
 * fourth commit nobody reads it, and by the tenth it is what `git log` looks
 * like. So the body is a table — one line per change, fixed columns, fingerprint
 * first, because that is the token a reader recognises when the same shape comes
 * back three months later.
 *
 * Nothing here argues. Everything that used to be argued in prose is in the
 * trailers, where the reader that needs it decodes it and the person scrolling
 * past does not pay for it.
 */
export function changelogBody(record: ChangelogRecord): readonly string[] {
  const lines: string[] = [];

  // The operator's own sentence, unlabelled. It is the one line here a person
  // wrote, and an `Intent:` prefix would be this format taking credit for it.
  if (record.intent !== undefined) lines.push(record.intent, '');

  for (const entry of record.entries.slice(0, NAMED_IN_PROSE)) lines.push(describe(entry));
  if (record.entries.length > NAMED_IN_PROSE) {
    lines.push(`+${String(record.entries.length - NAMED_IN_PROSE)} more in trailers`);
  }

  // On its own line rather than folded into a change: nothing in the run said
  // what changed in these subjects, and a count that cannot become a row must
  // not be printed as one.
  if (record.ungrouped > 0) lines.push(`+${String(record.ungrouped)} unshaped`);

  // The one finding that earns a full line of its own, because it is about what
  // no single review could see — including the one that produced this commit.
  for (const drift of record.drift ?? []) {
    lines.push(
      `drift ${drift.token} ${drift.from} -> ${drift.to} over ${String(drift.steps)} approvals`,
    );
  }

  lines.push(
    '',
    `run ${record.run} @ ${record.commit} ${selection(record.selection)}` +
      `${record.by === undefined ? '' : ` ${record.by}`}`,
  );

  return lines;
}

/**
 * One change, as columns: what it is, where it was, how much of it landed.
 *
 * The fingerprint leads because it is the only field on the line that is stable
 * *across* commits — the same shape returning is the finding, and a reader who
 * has seen `v1:9a3f1c2e04` before recognises it without reading the rest. It is
 * also the exact string `accept --shape` and an ignore take, so the line is
 * something to copy rather than something to interpret.
 *
 * A shape with no component keeps its digest rather than borrowing a name, and
 * says which it is. "An unnamed shape" is a weaker claim than a component, and a
 * line that hid the difference would let a bulk decision be read back as an
 * attributed one.
 *
 * `3/4` wherever the promotion was partial: the subjects this shape reached and
 * did not take are the part of the change still sitting in the suite, and a bare
 * count reads as though the whole shape landed.
 */
function describe(entry: ChangelogEntry): string {
  const what =
    entry.component === undefined
      ? `unnamed ${entry.fingerprint.slice(0, 12)}`
      : `${entry.component}${entry.file === undefined ? '' : ` ${entry.file}`}`;

  const subjects =
    entry.reached > entry.subjects.length
      ? `${String(entry.subjects.length)}/${String(entry.reached)}`
      : String(entry.subjects.length);

  return `${entry.fingerprint} ${what} ${subjects}${entry.cause ? '' : ' collateral'}`;
}

/**
 * The flag that chose the subjects, as the flag.
 *
 * `--all` accepts changed subjects as well as new ones — unattended, that is
 * regeneration rather than review, and it is the distinction this whole record
 * exists to keep. Carried as the flag rather than as the clause explaining it:
 * the clause is identical in every commit ever written, and the flag is the part
 * that differs between them.
 */
function selection(kind: ChangelogRecord['selection']): string {
  if (kind === 'all') return '--all';
  if (kind === 'shape') return '--shape';
  return '--subject';
}

/**
 * Read the record out of a commit message, or `undefined` when it carries none.
 *
 * `undefined` is *this commit is not a baseline update*, which is the answer for
 * almost every commit in a repository and is not a failure. A malformed one is,
 * and it throws: a record that half-parsed would answer "what changed here" with
 * the part that happened to survive.
 *
 * Keys this reader does not know are **kept, not refused**. A field added by a
 * later writer is not a corrupt record, it is a newer one, and a reader that
 * threw on it would make every additive change a breaking change — which is the
 * pressure that turns a version number into a wall nobody may cross. The version
 * is checked instead, and it moves only when an existing field changes meaning.
 */
export function parseCommitMessage(text: string): ChangelogRecord | undefined {
  const head = payload(text, HEAD);
  if (head === undefined) return undefined;

  const record = decode(head, HEAD) as Omit<ChangelogRecord, 'entries'>;
  if (record.changelogVersion !== 1) {
    throw new Error(
      `a commit carries a variance changelog with changelogVersion=${String(record.changelogVersion)}, ` +
        'which this reader does not know. Partly reading it would describe a baseline update by ' +
        'whichever fields happened to be recognised',
    );
  }

  const entries = payloads(text, CHANGE).map((value) => decode(value, CHANGE) as ChangelogEntry);
  for (const entry of entries) {
    if (typeof entry.fingerprint !== 'string' || !Array.isArray(entry.subjects)) {
      throw new Error(
        `a commit carries a \`${CHANGE}\` trailer that is not a change: it has no fingerprint or ` +
          'no subject list',
      );
    }
  }

  return { ...record, entries };
}

/**
 * Every value for a key, in message order.
 *
 * Anchored on the key and the version together, so a line mentioning the trailer
 * name in prose — a commit that *discusses* this format, of which this repository
 * has several — is not mistaken for one.
 */
function payloads(text: string, key: string): readonly string[] {
  const pattern = new RegExp(`^[ \\t]*${key}:[ \\t]+(\\S+)[ \\t]+(\\S+)[ \\t]*$`, 'gm');

  return [...text.matchAll(pattern)].map(([, version, value]) => {
    if (version !== VERSION) {
      throw new Error(
        `a commit carries a \`${key}\` trailer encoded as ${String(version)}, and this reader ` +
          `understands ${VERSION}`,
      );
    }
    return value ?? '';
  });
}

function payload(text: string, key: string): string | undefined {
  const found = payloads(text, key);
  if (found.length > 1) {
    throw new Error(
      `a commit carries ${String(found.length)} \`${key}\` trailers, and a commit updates ` +
        'baselines for one run. Two heads in one message is a rewritten history, not a record',
    );
  }
  return found[0];
}

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value: string, key: string): unknown {
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(
      `a commit carries a \`${key}\` trailer this reader cannot decode ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
}
