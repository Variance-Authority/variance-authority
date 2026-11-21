/**
 * Which declared checks the last run entered, case by case and attempt by
 * attempt. A case declares a check by writing `checked(id, fn)` in its body,
 * read from its test file, not from the run (`case-checks.ts`); an attempt enters
 * it when the call runs, told by the case scope every runner opens. A check a
 * passing attempt declared and did not enter passed without it.
 *
 * One run's account, replaced whole by the next run's: a case the next run did
 * not collect is not carried, because what it entered then says nothing of the
 * code now. A run that kept no checks leaves no section, which reads as not
 * kept, never as nothing missing. It never crosses a checkout or a shard
 * landing: it is this checkout's last run, as `cases.last` is.
 *
 * No selection reads it and no digest a selection compares takes it in.
 */

/** A check a case declares: its id, and where the body declares it. */
export interface DeclaredCheck {
  readonly id: string;
  /** The line of its `checked` call, or of the body's call of the helper that holds it. */
  readonly line: number;
}

/** One attempt of a case that declares checks. */
export interface CheckedAttempt {
  /** Counted from 1; a retry is attempt 2. */
  readonly attempt: number;
  /** How the attempt ended, in the runner's word; absent, the runner did not say. */
  readonly ended?: string;
  /** The declared checks the attempt entered, each once, in code-unit order. */
  readonly entered: readonly string[];
}

/** A case of the run that declares checks. */
export interface CheckedCase {
  /** The test file, repository-relative. */
  readonly file: string;
  /** The line of the call that registers its body. */
  readonly line: number;
  /** The declaration path inside the file, as the case index spells it. */
  readonly name: string;
  /** The project that ran it; absent for an unnamed one. */
  readonly project?: string;
  /** The checks it declares, each once, by line. */
  readonly declared: readonly DeclaredCheck[];
  /** Its attempts in order. */
  readonly attempts: readonly CheckedAttempt[];
}

/** One run's checks. */
export interface ChecksSection {
  /** The commit the run stood at, when it landed; absent where git named none. The coverage beside it may be an earlier run's. */
  readonly commit?: string;
  /** When the run's checks landed, as ISO 8601; absent before they land. */
  readonly landed?: string;
  /** The test files of `cases` where the runner did not end an attempt it began, in code-unit order; their cases are not judged. */
  readonly incomplete: readonly string[];
  readonly cases: readonly CheckedCase[];
}

/** A declared check an attempt of its case passed without entering. */
export interface MissingCheck {
  readonly check: string;
  /** Where the case declares it: {@link DeclaredCheck.line}. */
  readonly line: number;
  readonly case: CheckedCase;
  /** The attempt that passed without it, when the case ran more than once; absent, its only attempt did. */
  readonly attempt?: number;
}

/** What a run's checks say: what each passing attempt left out. */
export interface ChecksReading {
  /** Declared checks a passing attempt did not enter. */
  readonly missing: readonly MissingCheck[];
  /** Declared checks some attempt of their case entered, each counted once, in the files that ran to the end. */
  readonly entered: number;
  /** The test files where the runner did not end an attempt it began: no check of theirs is named missing. */
  readonly incomplete: readonly string[];
}

const VERSION = 2;

/** The section bytes for `section`. */
export function encodeChecks(section: ChecksSection): Uint8Array {
  return Buffer.from(`${JSON.stringify({ version: VERSION, ...section })}\n`);
}

/** The section bytes for `section`, as the run at `commit` lands them now. */
export function landedChecks(section: ChecksSection, commit: string | undefined): Uint8Array {
  return encodeChecks({ ...section, ...(commit === undefined ? {} : { commit }), landed: new Date().toISOString() });
}

/** What a checks section holds, refusing a section that is not one. */
export function decodeChecks(bytes: Uint8Array): ChecksSection {
  let section: unknown;
  try {
    section = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('the record\'s checks section is not JSON');
  }
  const candidate = section as Partial<ChecksSection & { version: number }> | null;
  if (typeof candidate !== 'object' || candidate === null || candidate.version !== VERSION ||
    !Array.isArray(candidate.incomplete) || !Array.isArray(candidate.cases) ||
    !['string', 'undefined'].includes(typeof candidate.commit) || !['string', 'undefined'].includes(typeof candidate.landed)) {
    throw new Error(`the record's checks section is not version ${VERSION}`);
  }
  const { commit, landed } = candidate;
  return {
    ...(commit === undefined ? {} : { commit }),
    ...(landed === undefined ? {} : { landed }),
    incomplete: candidate.incomplete,
    cases: candidate.cases,
  };
}

/**
 * What a run's checks say. An attempt that passed without entering a declared
 * check names it, once per attempt, and only from what that attempt entered: a
 * failed attempt that entered the check says nothing of the retry that passed.
 * One that failed, timed out or was skipped already says it did not pass. A
 * file where the runner did not end an attempt it began names none: that
 * attempt may have been stopped before it could enter one.
 */
export function readChecks(section: ChecksSection): ChecksReading {
  const incomplete = new Set(section.incomplete);
  const missing: MissingCheck[] = [];
  let entered = 0;
  for (const one of section.cases) {
    if (incomplete.has(one.file)) continue;
    const any = new Set(one.attempts.flatMap((attempt) => attempt.entered));
    entered += one.declared.filter((check) => any.has(check.id)).length;
    for (const attempt of one.attempts) {
      if (attempt.ended !== 'passed') continue;
      const done = new Set(attempt.entered);
      for (const check of one.declared) {
        if (done.has(check.id)) continue;
        missing.push({
          check: check.id,
          line: check.line,
          case: one,
          ...(one.attempts.length > 1 ? { attempt: attempt.attempt } : {}),
        });
      }
    }
  }
  return { missing, entered, incomplete: section.incomplete };
}
