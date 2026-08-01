import {
  normalize,
  type Digest,
  type Provenance,
  type RawCapture,
  type SemanticSnapshot,
  type SubjectRef,
  type Viewport,
} from '@variance-authority/core';
import { collect } from '@variance-authority/collector-dom';
import { readsOf } from './reads.js';
import {
  SheetRegistry,
  diffProbes,
  probe,
  type StateKey,
  type StateProbe,
} from './state.js';

/**
 * A session: one document, many subjects, no teardown between them.
 *
 * The expensive parts of a visual-regression run are the ones nobody counts —
 * constructing a JSDOM per test file, launching a browser per subject, reloading
 * a Storybook iframe between stories, re-parsing the design system's stylesheet
 * every time. A session pays each of those **once** and then runs subjects back
 * to back in the world that is already standing.
 *
 * The corner being cut is real, and so is what it costs: state leaks between
 * subjects. A stylesheet one story injects is still there for the next; a theme
 * class left on `<html>` restyles everything after it; an unmounted portal keeps
 * a node in `<body>`. Under a rinse-everything regime those are impossible.
 * Here they are possible, so they must be *detectable* — otherwise the saving is
 * paid for in baselines that quietly depend on execution order, which is a
 * content-addressing failure (Principle 4) dressed up as a flaky test.
 *
 * Detection is two-tier, and the tiers are not redundant:
 *
 * - **Suspicion** (free, always on). Diff a cheap probe around each subject to
 *   learn what it wrote; derive from its capture what it read. A later subject
 *   reading what an earlier one wrote is a suspected conflict. Cheap enough to
 *   leave on, and it is the tier that *names a culprit*.
 * - **Confirmation** (sampled, opt-in). Re-run subjects at the end of the session
 *   and compare hashes against their first run. A hash that moved with no code
 *   change is proof of order-dependence, needing no inference at all — but on its
 *   own it tells you a subject is unstable, not who made it so.
 *
 * Suspicion without confirmation over-reports. Confirmation without suspicion
 * cannot attribute. Together they produce the sentence an agent can act on:
 * *"`story:card` is order-dependent; `story:button` wrote `sheet:<style:3>`,
 * which `story:card` matched via `.btn`."*
 */

export interface SessionOptions {
  readonly document: Document;
  readonly viewport: Viewport;
  readonly engine: string;
  readonly provenanceOf?: (element: Element) => Provenance | undefined;
  readonly portalsOf?: (root: Element) => readonly Element[];
  readonly fonts?: readonly string[];

  /**
   * Clear the subject container between runs. Default `true`.
   *
   * This is the one teardown a session still performs, because it is the one that
   * is cheap: emptying a container is proportional to the last subject, while
   * rebuilding a document is proportional to everything. Set `false` to model a
   * suite that appends without cleaning up — which is a real pattern, and one the
   * pollution detector should be able to describe rather than forbid.
   */
  readonly clearContainer?: boolean;
}

export interface SubjectRun {
  readonly subject: SubjectRef;
  readonly capture: RawCapture;
  readonly snapshot: SemanticSnapshot;
  readonly reads: ReadonlySet<StateKey>;
  readonly writes: ReadonlySet<StateKey>;
  /** Position in the session. Ordering is what makes a conflict directional. */
  readonly sequence: number;
  readonly durationMs: number;
}

export interface Finding {
  /** `suspected` from read/write overlap; `confirmed` by a hash that moved. */
  readonly confidence: 'suspected' | 'confirmed';
  readonly victim: string;
  /** Absent when a hash moved but no earlier writer explains it. */
  readonly culprit?: string;
  readonly key?: StateKey;
  readonly evidence: string;
  /** What an agent should do about it. */
  readonly remedy: string;
}

export interface SessionStats {
  readonly subjects: number;
  readonly totalMs: number;
  readonly probeMs: number;
  /** Probe overhead as a fraction of session time — the price of not rinsing. */
  readonly probeShare: number;
}

export function createSession(options: SessionOptions): Session {
  return new Session(options);
}

export class Session {
  readonly #options: SessionOptions;
  readonly #registry = new SheetRegistry();
  readonly #runs: SubjectRun[] = [];
  readonly #firstHash = new Map<string, Digest>();
  readonly #evidence = new Map<string, ReadonlyMap<StateKey, string>>();
  readonly #container: HTMLElement;
  #probeMs = 0;
  #totalMs = 0;

  constructor(options: SessionOptions) {
    this.#options = options;
    this.#container = options.document.createElement('div');
    this.#container.setAttribute('data-va-subject-root', '');
    options.document.body.appendChild(this.#container);
  }

  /** The element subjects mount into. Stable for the session's lifetime. */
  get container(): HTMLElement {
    return this.#container;
  }

  /**
   * Run one subject: mount, probe, collect, normalize, record.
   *
   * `mount` is given the container and is expected to render synchronously. The
   * probe brackets the mount rather than the collection, so that work the
   * *collector* does — which touches nothing — is not mistaken for a write.
   */
  run(subject: SubjectRef, mount: (container: HTMLElement) => void): SubjectRun {
    const started = now();

    if (this.#options.clearContainer !== false) this.#container.replaceChildren();

    const probeStart = now();
    const before = this.#probe();
    this.#probeMs += now() - probeStart;

    mount(this.#container);

    const probeEnd = now();
    const after = this.#probe();
    this.#probeMs += now() - probeEnd;

    const capture = collect(this.#container, {
      subject,
      viewport: this.#options.viewport,
      engine: this.#options.engine,
      fonts: this.#options.fonts ?? [],
      ...(this.#options.provenanceOf ? { provenanceOf: this.#options.provenanceOf } : {}),
      ...(this.#options.portalsOf ? { portalsOf: this.#options.portalsOf } : {}),
    });

    const snapshot = normalize(capture);
    const reads = readsOf(capture, snapshot);
    const { written } = diffProbes(before, after);

    const run: SubjectRun = {
      subject,
      capture,
      snapshot,
      reads: reads.keys,
      writes: written,
      sequence: this.#runs.length,
      durationMs: now() - started,
    };

    this.#runs.push(run);
    this.#evidence.set(subject.id, reads.evidence);
    if (!this.#firstHash.has(subject.id)) {
      this.#firstHash.set(subject.id, snapshot.renderHash);
    }
    this.#totalMs += run.durationMs;

    return run;
  }

  /**
   * Re-run subjects and confirm their hashes did not move.
   *
   * This is the empirical tier, and it is the only thing here that *proves*
   * anything. Sampled rather than exhaustive because re-running everything would
   * double the session and give back the saving — the point is to spend a little
   * to check the corner-cut held, not to pay full price twice.
   *
   * A hash that moved is order-dependence, full stop: same code, same subject,
   * different answer. `findings()` then matches it against the ledger to say who.
   */
  verify(
    replay: (subject: SubjectRef, container: HTMLElement) => void,
    sample?: readonly string[],
  ): readonly Finding[] {
    const confirmed: Finding[] = [];
    const targets =
      sample ?? [...new Set(this.#runs.map((run) => run.subject.id))];

    for (const id of targets) {
      const original = this.#runs.find((run) => run.subject.id === id);
      if (!original) continue;

      const rerun = this.run(original.subject, (container) =>
        replay(original.subject, container),
      );

      const expected = this.#firstHash.get(id);
      if (expected === undefined || rerun.snapshot.renderHash === expected) continue;

      const culprit = this.#culpritBetween(original, rerun);

      confirmed.push({
        confidence: 'confirmed',
        victim: id,
        ...(culprit ? { culprit: culprit.subject.id, key: culprit.key } : {}),
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
      });
    }

    return confirmed;
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

  /** Restore shared state to what it was before a given subject ran. */
  rinse(keys: readonly StateKey[]): void {
    const current = this.#probe();

    for (const key of keys) {
      const sheet = current.sheets.get(key);
      // Only sheet removal is reversible from a probe alone. Attribute and
      // custom-property restoration would need the pre-session value, which is
      // deliberately not retained: keeping every prior value would make the probe
      // grow with the session, and the probe has to stay cheap for any of this to
      // pay off.
      if (sheet?.ownerNode) (sheet.ownerNode as ChildNode).remove();
    }
  }

  stats(): SessionStats {
    return {
      subjects: this.#runs.length,
      totalMs: this.#totalMs,
      probeMs: this.#probeMs,
      probeShare: this.#totalMs === 0 ? 0 : this.#probeMs / this.#totalMs,
    };
  }

  runs(): readonly SubjectRun[] {
    return this.#runs;
  }

  dispose(): void {
    this.#container.remove();
  }

  #probe(): StateProbe {
    return probe(this.#options.document, {
      ownedContainers: [this.#container],
      registry: this.#registry,
    });
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
}

function dedupe(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const unique: Finding[] = [];

  for (const finding of findings) {
    const signature = `${finding.victim}|${finding.culprit ?? ''}|${finding.key ?? ''}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(finding);
  }

  return unique;
}

function short(digest: Digest): string {
  return digest.slice(0, 11);
}

function now(): number {
  return typeof performance === 'object' ? performance.now() : Date.now();
}
