import type {
  Digest,
  RawCapture,
  SemanticSnapshot,
  SubjectRef,
} from '@variance-authority/core/format';
import { dedupe, short, type Finding } from './findings.js';
import type { StateKey } from './state.js';

/**
 * The ledger: what each subject did, and who that implicates.
 *
 * `Session` owns the standing world — a container, a document, a probe. This
 * owns the record of what happened in it: one `SubjectRun` per subject, the
 * first hash each subject produced, and the reason each key counts as read.
 * They are separate because they are spent at different times. Recording sits
 * on the hot path, once per subject, and has to stay as cheap as the probe it
 * follows; attribution runs once at the end and is allowed to be quadratic in
 * subjects, which `findings()` in fact is.
 *
 * Every accusation here is derived from the ledger alone — no DOM, no document,
 * no re-render. That is deliberate. A detector able to touch the world it is
 * judging could change it, and a diagnosis that perturbs its own evidence is
 * not one.
 */

export interface SubjectRun {
  readonly subject: SubjectRef;
  readonly capture: RawCapture;
  readonly snapshot: SemanticSnapshot;
  readonly reads: ReadonlySet<StateKey>;
  readonly writes: ReadonlySet<StateKey>;
  /** Position in the session. Ordering is what makes a conflict directional. */
  readonly sequence: number;
  /**
   * Wall clock from the clearing of the container to the recorded run.
   *
   * A subject that declares its readiness is timed with its own waiting
   * included, because that waiting is what the session actually spent. It also
   * means a session full of asynchronous subjects dilutes `probeShare` — the
   * probe did not get cheaper, the denominator got larger.
   */
  readonly durationMs: number;
}

export class Ledger {
  readonly #runs: SubjectRun[] = [];
  readonly #firstHash = new Map<string, Digest>();
  readonly #evidence = new Map<string, ReadonlyMap<StateKey, string>>();

  /** The position the next recorded run will take. */
  get nextSequence(): number {
    return this.#runs.length;
  }

  /**
   * Record a run, and why each of its reads is a read.
   *
   * The first hash a subject produced is kept and never overwritten, because it
   * is what a re-run is compared against; overwriting it would make every
   * subject agree with its most recent self and confirm nothing.
   */
  record(run: SubjectRun, evidence: ReadonlyMap<StateKey, string>): void {
    this.#runs.push(run);
    this.#evidence.set(run.subject.id, evidence);
    if (!this.#firstHash.has(run.subject.id)) {
      this.#firstHash.set(run.subject.id, run.snapshot.renderHash);
    }
  }

  runs(): readonly SubjectRun[] {
    return this.#runs;
  }

  /** The earliest recorded run of a subject id, or `undefined` if it never ran. */
  first(id: string): SubjectRun | undefined {
    return this.#runs.find((run) => run.subject.id === id);
  }

  /** Distinct subject ids in first-run order — `verify()`'s default sample. */
  subjectIds(): readonly string[] {
    return [...new Set(this.#runs.map((run) => run.subject.id))];
  }

  /**
   * Suspected conflicts, from read/write overlap alone.
   *
   * Directional: only writes by subjects that ran *earlier* can have reached a
   * given subject. A subject that writes a key it also reads is not polluting
   * anyone — that is just a component managing its own stylesheet.
   */
  findings(): readonly Finding[] {
    const found: Finding[] = [];

    for (const victim of this.#runs) {
      for (const key of victim.reads) {
        for (const writer of this.#runs) {
          if (writer.sequence >= victim.sequence) continue;
          if (writer.subject.id === victim.subject.id) continue;
          if (!writer.writes.has(key)) continue;

          found.push({
            confidence: 'suspected',
            victim: victim.subject.id,
            culprit: writer.subject.id,
            culpritComponents: this.#componentsOf(writer.subject.id),
            key,
            evidence:
              `\`${writer.subject.id}\` wrote \`${key}\`; \`${victim.subject.id}\` ` +
              `${this.#why(victim.subject.id, key)}`,
            remedy:
              `confirm with \`verify()\`. If the hash moves, scope \`${key}\` to ` +
              `\`${writer.subject.id}\` or clean it up; if it does not, the coupling is ` +
              `real but currently harmless`,
          });
        }
      }
    }

    return dedupe(found);
  }

  /**
   * A confirmed finding when a subject's hash moved between its runs, `null`
   * when it held.
   */
  confirm(original: SubjectRun, rerun: SubjectRun): Finding | null {
    const id = original.subject.id;
    const expected = this.#firstHash.get(id);
    if (expected === undefined || rerun.snapshot.renderHash === expected) return null;

    const culprit = this.#culpritBetween(original, rerun);

    return {
      confidence: 'confirmed',
      victim: id,
      ...(culprit
        ? {
            culprit: culprit.subject.id,
            key: culprit.key,
            culpritComponents: this.#componentsOf(culprit.subject.id),
          }
        : {}),
      evidence:
        `re-running \`${id}\` in the same session produced a different render hash ` +
        `(${short(expected)} → ${short(rerun.snapshot.renderHash)}) with no code change` +
        (culprit
          ? `; \`${culprit.subject.id}\` wrote \`${culprit.key}\`, which this subject ` +
            `${this.#why(id, culprit.key)}`
          : '; no earlier subject wrote anything this one reads, so the instability is ' +
            'inside the subject itself — a timer, a random value, or an unsettled animation'),
      remedy: culprit
        ? `make \`${culprit.subject.id}\` clean up \`${culprit.key}\`, or scope it so it ` +
          `cannot reach \`${id}\``
        : `make \`${id}\` deterministic; a session cannot stabilise what re-renders differently`,
    };
  }

  /**
   * Who wrote something the victim reads, *between* its two runs.
   *
   * The window matters. A subject that wrote before the victim's first run
   * affected both runs equally and cannot explain a hash that moved between them
   * — naming it would send an agent to fix code that is not the cause. Only
   * writes in the interval are candidates.
   */
  #culpritBetween(
    original: SubjectRun,
    rerun: SubjectRun,
  ): { subject: SubjectRef; key: StateKey } | null {
    for (const writer of this.#runs) {
      if (writer.sequence <= original.sequence || writer.sequence >= rerun.sequence) continue;
      if (writer.subject.id === original.subject.id) continue;

      for (const key of writer.writes) {
        if (original.reads.has(key) || rerun.reads.has(key)) {
          return { subject: writer.subject, key };
        }
      }
    }
    return null;
  }

  #why(subjectId: string, key: StateKey): string {
    return this.#evidence.get(subjectId)?.get(key) ?? 'reads it';
  }

  /** Distinct component names a subject rendered, outermost last. */
  #componentsOf(subjectId: string): readonly string[] {
    const run = this.#runs.find((candidate) => candidate.subject.id === subjectId);
    if (!run) return [];

    const names = new Set<string>();
    const visit = (node: { provenance?: { owners: readonly { name: string }[] }; children: readonly unknown[] }): void => {
      for (const owner of node.provenance?.owners ?? []) names.add(owner.name);
      for (const child of node.children) visit(child as Parameters<typeof visit>[0]);
    };
    visit(run.snapshot.root);

    return [...names];
  }
}
