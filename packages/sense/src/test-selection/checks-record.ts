/**
 * Which declared checks the last run entered, case by case and attempt by
 * attempt, and the scope it ran in. A case declares a check by id; the run
 * enters it when the case executes the step of that id. A check a case declared
 * and no attempt of it entered did not run, whatever the case's verdict.
 *
 * One run's account, replaced whole by the next run's: a case the next run did
 * not collect is not carried, because what it entered then says nothing of the
 * code now. A run that kept no checks leaves no section, which reads as not
 * kept, never as nothing missing. It never crosses a checkout or a shard
 * landing: it is this checkout's last run, as `cases.last` is.
 *
 * No selection reads it and no digest a selection compares takes it in.
 */

/** What the run was asked to run: a case outside it was not collected, and no check of it is missing. */
export interface ChecksScope {
  /** Each project the run collected from, with the filters its runner narrowed it by, spelled as the runner prints them. */
  readonly projects: readonly {
    readonly name: string;
    /** The pattern a case's title had to match; absent, every title matched. */
    readonly grep?: string;
    /** The pattern a case's title must not match; absent, none was excluded. */
    readonly grepInvert?: string;
  }[];
  /** The command line's `--grep` as typed, over each project's own; absent, it named none. */
  readonly grep?: string;
  /** The command line's `--grep-invert` as typed; absent, it named none. */
  readonly grepInvert?: string;
  /** The part of the suite this run was, `current` of `total`; absent, the whole. */
  readonly shard?: { readonly current: number; readonly total: number };
  /** How many spec files a test selection left out of the run; absent, it left out none. */
  readonly skipped?: number;
}

/** One attempt of a case that declares checks. */
export interface CheckedAttempt {
  /** Counted from 1; a retry is attempt 2. */
  readonly attempt: number;
  /** How the attempt ended, in the runner's word; absent, it never ended. */
  readonly ended?: string;
  /** The declared checks the attempt entered, each once, in code-unit order. */
  readonly entered: readonly string[];
}

/** A collected case that declares checks. */
export interface CheckedCase {
  /** The test file, repository-relative. */
  readonly file: string;
  /** The line the case is declared on. */
  readonly line: number;
  /** The declaration path inside the file, as the case index spells it. */
  readonly name: string;
  /** The project that collected it; absent for an unnamed one. */
  readonly project?: string;
  /** The checks it declares, each once, in code-unit order. */
  readonly declared: readonly string[];
  /** Its attempts in order; none when it was collected and never started. */
  readonly attempts: readonly CheckedAttempt[];
}

/** One run's checks. */
export interface ChecksSection {
  /** Whether the runner ended the run itself; a run it was stopped short of names no check missing. */
  readonly complete: boolean;
  readonly scope: ChecksScope;
  readonly cases: readonly CheckedCase[];
}

/** A declared check an attempt of its case passed without entering. */
export interface MissingCheck {
  readonly check: string;
  readonly case: CheckedCase;
  /** The attempt that passed without it, when the case ran more than once; absent, its only attempt did. */
  readonly attempt?: number;
}

/** What a run's checks say: what each case that ran left out. */
export interface ChecksReading {
  readonly complete: boolean;
  readonly scope: ChecksScope;
  /** Declared checks an attempt passed without entering; none for a run that did not complete. */
  readonly missing: readonly MissingCheck[];
  /** Declared checks some attempt of their case entered, each counted once. */
  readonly entered: number;
}

/** The section bytes for `section`. */
export function encodeChecks(section: ChecksSection): Uint8Array {
  return Buffer.from(`${JSON.stringify({ version: 1, ...section })}\n`);
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
  if (typeof candidate !== 'object' || candidate === null || candidate.version !== 1 ||
    typeof candidate.complete !== 'boolean' || typeof candidate.scope !== 'object' || !Array.isArray(candidate.cases)) {
    throw new Error('the record\'s checks section is not version 1');
  }
  return { complete: candidate.complete, scope: candidate.scope!, cases: candidate.cases };
}

/**
 * What a run's checks say. An attempt that passed without entering a declared
 * check names it, once per attempt: one that failed, timed out or was skipped
 * already says it did not pass. A run the runner did not end names none,
 * because its last attempts were stopped before they could.
 */
export function readChecks(section: ChecksSection): ChecksReading {
  const missing: MissingCheck[] = [];
  let entered = 0;
  for (const one of section.cases) {
    const any = new Set(one.attempts.flatMap((attempt) => attempt.entered));
    entered += one.declared.filter((check) => any.has(check)).length;
    for (const attempt of one.attempts) {
      const done = new Set(attempt.entered);
      if (!section.complete || attempt.ended !== 'passed') continue;
      for (const check of one.declared) {
        if (done.has(check)) continue;
        missing.push({
          check,
          case: one,
          ...(one.attempts.length > 1 ? { attempt: attempt.attempt } : {}),
        });
      }
    }
  }
  return { complete: section.complete, scope: section.scope, missing, entered };
}
