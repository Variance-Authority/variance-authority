import {
  normalize,
  type Provenance,
  type SubjectRef,
  type Viewport,
} from '@variance-authority/core';
import { collect } from '@variance-authority/dom';
import { formatFindings, type Finding } from './findings.js';
import { Ledger, type SubjectRun } from './ledger.js';
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
 *
 * This file holds the standing world and the two paths through it. The record of
 * what ran and the inference over it are in `ledger.ts`; the wording of an
 * accusation is in `findings.ts`.
 */

export type { SubjectRun } from './ledger.js';
export type { Finding } from './findings.js';

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
  readonly #ledger = new Ledger();
  readonly #container: HTMLElement;
  #probeMs = 0;
  #totalMs = 0;
  /** Id of the subject whose mount has not settled yet, or `null`. */
  #mounting: string | null = null;

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
   * `mount` is given the container and may finish in one of two ways. Returning
   * nothing means it is already done, and that path stays exactly as
   * synchronous as it was — no microtask, no await, no ceremony, because it is
   * the overwhelming majority of subjects and the whole package exists to be
   * cheap. Returning a promise means the subject is *declaring* when it is
   * finished, and `run` waits for that declaration before photographing
   * anything. A signal from the subject beats any timeout, animation-frame count
   * or mutation-quiet heuristic this package could pick, because only the
   * subject knows what it was waiting for; the cost is that a subject which
   * never settles hangs the session rather than producing a wrong answer, which
   * is the right way round.
   *
   * Whichever path it took, the container must not be empty when the collector
   * arrives — see `#requireRendered`. That check is what makes the asynchronous
   * path an improvement rather than a second way to be wrong.
   *
   * The container is the *same element* every run, which React notices: calling
   * `createRoot` on it twice warns and leaks the previous root. Callers using
   * React should create one root per session and call `root.render` per subject.
   * This is the sharp edge of container reuse, and it is a caller-side concern —
   * the session cannot own a React root without depending on React.
   *
   * @throws {Error} when the subject rendered nothing, or when another subject
   * is still mounting.
   */
  // The promise-returning overload is declared first on purpose. A parameter
  // typed `=> void` accepts a function returning anything, promises included, so
  // a sync-first order would match every `async` mount against it and hand the
  // caller a `SubjectRun` that is really a `Promise<SubjectRun>` — the exact
  // "looked at the wrong object and saw no difference" failure being fixed here,
  // relocated into the type system.
  run(
    subject: SubjectRef,
    mount: (container: HTMLElement) => PromiseLike<unknown>,
  ): Promise<SubjectRun>;
  run(subject: SubjectRef, mount: (container: HTMLElement) => void): SubjectRun;
  run(
    subject: SubjectRef,
    mount: (container: HTMLElement) => unknown,
  ): SubjectRun | Promise<SubjectRun> {
    return this.#runOnce(subject, mount);
  }

  #runOnce(
    subject: SubjectRef,
    mount: (container: HTMLElement) => unknown,
  ): SubjectRun | Promise<SubjectRun> {
    if (this.#mounting !== null) {
      // One session, one container. Two subjects mounting into it concurrently
      // photograph each other's DOM, and unlike an empty container the result
      // looks plausible enough to be baselined.
      throw new Error(
        `refusing to start \`${subject.id}\` while \`${this.#mounting}\` is still mounting: ` +
          `a session has one container, so overlapping subjects would each be collected with ` +
          `the other's DOM in it; await the previous run before starting the next`,
      );
    }

    const started = now();

    if (this.#options.clearContainer !== false) this.#container.replaceChildren();

    const probeStart = now();
    const before = this.#probe();
    this.#probeMs += now() - probeStart;

    const settled = mount(this.#container);

    if (!isThenable(settled)) return this.#photograph(subject, before, started);

    this.#mounting = subject.id;

    return Promise.resolve(settled)
      .finally(() => {
        this.#mounting = null;
      })
      .then(() => this.#photograph(subject, before, started));
  }

  /**
   * Close the probe bracket, collect, and record — once the subject is ready.
   *
   * Split out of `run` so that both paths photograph the world in exactly the
   * same way. The probe brackets the mount rather than the collection, so that
   * work the *collector* does — which touches nothing — is not mistaken for a
   * write.
   */
  #photograph(subject: SubjectRef, before: StateProbe, started: number): SubjectRun {
    this.#requireRendered(subject);

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
      sequence: this.#ledger.nextSequence,
      durationMs: now() - started,
    };

    this.#ledger.record(run, reads.evidence);
    this.#totalMs += run.durationMs;

    return run;
  }

  /**
   * Refuse a subject that rendered nothing.
   *
   * This is the canonical vacuous positive: an empty container is byte-identical
   * to every other empty container, so its snapshot agrees with any baseline
   * taken the same way and the subject reports `unchanged` forever while showing
   * nothing at all. A missing answer is recoverable; a confident wrong one is
   * not, so the artifact is refused rather than produced.
   *
   * "Rendered" is deliberately wider than "has element children". The collector
   * captures text nodes, so a subject whose entire output is a string is
   * observable and refusing it would be a false alarm — and a check that fires
   * on legitimate subjects is a check that gets switched off. Comments and
   * whitespace-only text do not count: they are what a container that rendered
   * nothing tends to contain.
   *
   * Two limits worth knowing. `portalsOf` is consulted only when the container
   * itself looks empty, so the common path pays nothing for it — but a subject
   * whose whole output is portalled is only rescued when a portal provider is
   * configured; without one it is refused, which is the safe direction given the
   * collector could not have seen its content either. And under
   * `clearContainer: false` the previous subject's DOM satisfies this check, so
   * a subject that mounts nothing is caught only when it is the first to run.
   */
  #requireRendered(subject: SubjectRef): void {
    if (this.#rendered()) return;

    throw new Error(
      `refusing to snapshot an empty subject \`${subject.id}\`: mount returned without ` +
        `rendering anything into the container. An empty container compares equal to every ` +
        `other empty container, so this snapshot would report \`unchanged\` no matter how the ` +
        `subject changed. If it renders asynchronously, return a promise from mount — run() ` +
        `awaits it.`,
    );
  }

  #rendered(): boolean {
    if (this.#container.firstElementChild !== null) return true;

    for (const node of this.#container.childNodes) {
      // 3 is TEXT_NODE, spelled numerically because this package must work
      // against a `Document` from any realm, where the global `Node` is absent.
      if (node.nodeType === 3 && (node.nodeValue ?? '').trim() !== '') return true;
    }

    return (this.#options.portalsOf?.(this.#container) ?? []).length > 0;
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
   *
   * `replay` may declare readiness the same way `mount` does, and for the same
   * reason: a subject re-run into a container it has not filled yet would have
   * its hash compared against a real one and be confirmed as unstable — a
   * fabricated finding, which is worse than none because it is proof-shaped.
   * Overload order matches `run`'s, and so does the argument for it.
   */
  verify(
    replay: (subject: SubjectRef, container: HTMLElement) => PromiseLike<unknown>,
    sample?: readonly string[],
  ): Promise<readonly Finding[]>;
  verify(
    replay: (subject: SubjectRef, container: HTMLElement) => void,
    sample?: readonly string[],
  ): readonly Finding[];
  verify(
    replay: (subject: SubjectRef, container: HTMLElement) => unknown,
    sample?: readonly string[],
  ): readonly Finding[] | Promise<readonly Finding[]> {
    const targets = sample ?? this.#ledger.subjectIds();
    return this.#verifyFrom(0, targets, replay, []);
  }

  /**
   * Re-run `targets` from `start`, suspending only where a subject asks it to.
   *
   * A plain loop cannot pause, and an `async` loop would drag every synchronous
   * session onto the microtask queue for nothing. This runs as a loop until a
   * replay declares readiness, then resumes itself from the next index inside
   * the continuation — so the synchronous path never allocates a promise, and
   * the asynchronous one recurses through `then`, which flattens rather than
   * growing the stack.
   */
  #verifyFrom(
    start: number,
    targets: readonly string[],
    replay: (subject: SubjectRef, container: HTMLElement) => unknown,
    confirmed: Finding[],
  ): readonly Finding[] | Promise<readonly Finding[]> {
    for (let index = start; index < targets.length; index += 1) {
      const id = targets[index];
      if (id === undefined) continue;

      const original = this.#ledger.first(id);
      if (!original) continue;

      const outcome = this.#runOnce(original.subject, (container) =>
        replay(original.subject, container),
      );

      if (isThenable(outcome)) {
        const next = index + 1;
        return outcome.then((rerun) => {
          this.#confirm(confirmed, original, rerun);
          return this.#verifyFrom(next, targets, replay, confirmed);
        });
      }

      this.#confirm(confirmed, original, outcome);
    }

    return confirmed;
  }

  /** Record a confirmed finding when a subject's hash moved between its runs. */
  #confirm(confirmed: Finding[], original: SubjectRun, rerun: SubjectRun): void {
    const finding = this.#ledger.confirm(original, rerun);
    if (finding !== null) confirmed.push(finding);
  }

  /**
   * Suspected conflicts, from read/write overlap alone.
   *
   * Directional: only writes by subjects that ran *earlier* can have reached a
   * given subject. A subject that writes a key it also reads is not polluting
   * anyone — that is just a component managing its own stylesheet.
   */
  findings(): readonly Finding[] {
    return this.#ledger.findings();
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
      subjects: this.#ledger.runs().length,
      totalMs: this.#totalMs,
      probeMs: this.#probeMs,
      probeShare: this.#totalMs === 0 ? 0 : this.#probeMs / this.#totalMs,
    };
  }

  runs(): readonly SubjectRun[] {
    return this.#ledger.runs();
  }

  /**
   * Findings as text an agent can act on without re-deriving the diagnosis.
   *
   * Confirmed first: those are proven, and an agent working a list should not
   * spend its first move on a coupling that may never bite.
   */
  report(findings: readonly Finding[] = this.findings()): string {
    return formatFindings(findings);
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
}

function now(): number {
  return typeof performance === 'object' ? performance.now() : Date.now();
}

/**
 * Does this value declare when it is finished?
 *
 * Structural rather than `instanceof Promise`, because a subject's promise
 * routinely comes from another realm — a JSDOM window, a Storybook iframe, a
 * transpiler's polyfill — and `instanceof` answers "no" for all of them. A false
 * "no" here silently reinstates the defect: the mount is not awaited and an
 * empty container is photographed. The cost of the structural test is that a
 * non-promise object with a callable `then` is awaited, which is what `await`
 * would do with it anyway.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
