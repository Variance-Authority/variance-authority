// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SubjectRef, Viewport } from '@variance-authority/core/format';
import {
  createSession,
  diffProbes,
  probe,
  SheetRegistry,
  type Session,
} from './index.js';

/**
 * These tests are the argument for the corner being cut, and the check that it
 * is survivable.
 *
 * Two halves, and both are needed. The first says the saving is real: benign
 * accumulation — stylesheets piling up, ids renumbering, classes churning — must
 * not move a hash and must not raise a finding, or a no-rinse session would be
 * unusable noise. The second says the risk is caught: genuine leakage must be
 * detected, attributed to the subject that caused it, and described specifically
 * enough that an agent can fix the code without re-deriving the diagnosis.
 *
 * A detector that only passes the first half is a detector that has been turned
 * off. One that only passes the second is a rinse in disguise.
 */

const VIEWPORT: Viewport = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };

const subject = (id: string): SubjectRef => ({ id, kind: 'story' });

let session: Session;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('class');
  document.documentElement.removeAttribute('data-theme');
  session = createSession({ document, viewport: VIEWPORT, engine: 'jsdom@test', fonts: [] });
});

afterEach(() => {
  session.dispose();
});

/** Inject a stylesheet the way a CSS-in-JS runtime does: append and never remove. */
function inject(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function mountButton(container: HTMLElement): void {
  container.innerHTML = '<button class="btn">Save</button>';
}

function mountCard(container: HTMLElement): void {
  container.innerHTML = '<div class="card"><p class="card-body">Hello</p></div>';
}

describe('the low-level probe bracket', () => {
  it('names a stylesheet write without treating the owned container as residue', () => {
    const registry = new SheetRegistry();
    const before = probe(document, { registry, ownedContainers: [session.container] });

    inject('.probe-only { color: rebeccapurple }');

    const after = probe(document, { registry, ownedContainers: [session.container] });
    const delta = diffProbes(before, after);

    expect(delta.written).toContain('sheet:<style:0>');
  });
});

// ===========================================================================
// The saving: benign accumulation must be free
// ===========================================================================

describe('what a session is allowed to ignore', () => {
  it('does not move a hash when unrelated stylesheets pile up', () => {
    // The whole economic case. A hundred stories' worth of accreted CSS-in-JS is
    // still in the document when the hundred-and-first runs; if that moved its
    // hash, every baseline would decay with position in the run order.
    const first = session.run(subject('story:card'), (container) => {
      inject('.btn { color: blue }');
      mountCard(container);
    });

    for (let generation = 0; generation < 50; generation += 1) {
      inject(`.leftover-${generation} { color: rgb(${generation} 0 0) }`);
    }

    const later = session.run(subject('story:card'), mountCard);

    expect(later.snapshot.renderHash).toBe(first.snapshot.renderHash);
  });

  it('raises no finding for a sheet nothing in the subject matches', () => {
    session.run(subject('story:button'), (container) => {
      inject('.totally-unrelated { color: red }');
      mountButton(container);
    });
    session.run(subject('story:card'), mountCard);

    expect(session.findings()).toEqual([]);
  });

  it('does not blame a subject for its own stylesheet', () => {
    // A component that injects the CSS it needs writes and reads the same key.
    // That is not pollution, it is how CSS-in-JS works.
    session.run(subject('story:button'), (container) => {
      inject('.btn { color: blue }');
      mountButton(container);
    });
    session.run(subject('story:button'), (container) => {
      inject('.btn { color: blue }');
      mountButton(container);
    });

    expect(session.findings().filter((f) => f.victim === f.culprit)).toEqual([]);
  });

  it('does not report a write that happened after the subject ran', () => {
    // Pollution is directional. A later subject cannot have reached an earlier one.
    session.run(subject('story:card'), mountCard);
    session.run(subject('story:button'), (container) => {
      inject('.card { padding: 99px }');
      mountButton(container);
    });

    expect(session.findings().filter((f) => f.victim === 'story:card')).toEqual([]);
  });

  it('keeps probe overhead a small share of session time', () => {
    for (let index = 0; index < 20; index += 1) {
      session.run(subject(`story:s${index}`), mountCard);
    }

    // The probe is what replaces teardown. If it ever approached the cost of the
    // work it replaces, the trade would be pointless — so its share is asserted,
    // not assumed.
    expect(session.stats().probeShare).toBeLessThan(0.5);
  });
});

// ===========================================================================
// The risk: real leakage must be caught and attributed
// ===========================================================================

describe('cross-pollution detection', () => {
  it('suspects a subject whose leaked rule reaches a later one', () => {
    session.run(subject('story:button'), (container) => {
      // The leak: a rule scoped to nothing, matching a component this story does
      // not own.
      inject('.card { padding: 99px }');
      mountButton(container);
    });
    session.run(subject('story:card'), mountCard);

    const findings = session.findings();
    const leak = findings.find((f) => f.victim === 'story:card');

    expect(leak).toBeDefined();
    expect(leak!.culprit).toBe('story:button');
    expect(leak!.confidence).toBe('suspected');
  });

  it('names the selector that made the connection', () => {
    // "Something leaked" is not actionable. "`.card` matched" is.
    session.run(subject('story:button'), (container) => {
      inject('.card { padding: 99px }');
      mountButton(container);
    });
    session.run(subject('story:card'), mountCard);

    const leak = session.findings().find((f) => f.victim === 'story:card')!;

    expect(leak.evidence).toContain('story:button');
    expect(leak.evidence).toContain('.card');
    expect(leak.remedy).toContain('story:button');
  });

  it('confirms order-dependence by re-running and comparing hashes', () => {
    // The empirical tier. No inference: same subject, same code, different hash.
    session.run(subject('story:card'), mountCard);
    session.run(subject('story:button'), (container) => {
      inject('.card { padding: 99px }');
      mountButton(container);
    });

    const confirmed = session.verify((ref, container) => {
      if (ref.id === 'story:card') mountCard(container);
      else mountButton(container);
    }, ['story:card']);

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.confidence).toBe('confirmed');
    expect(confirmed[0]!.victim).toBe('story:card');
    expect(confirmed[0]!.culprit).toBe('story:button');
    expect(confirmed[0]!.evidence).toMatch(/different render hash/);
  });

  it('confirms nothing when the session is clean', () => {
    session.run(subject('story:card'), mountCard);
    session.run(subject('story:button'), mountButton);

    const confirmed = session.verify((ref, container) => {
      if (ref.id === 'story:card') mountCard(container);
      else mountButton(container);
    });

    expect(confirmed).toEqual([]);
  });

  it('catches a theme class left on the root element', () => {
    // The nastiest real case: a story toggles dark mode and never toggles back,
    // restyling every subject that runs after it.
    session.run(subject('story:card'), (container) => {
      inject('html.dark .card { color: white }');
      mountCard(container);
    });
    session.run(subject('story:theme-toggle'), (container) => {
      document.documentElement.classList.add('dark');
      container.innerHTML = '<button>Toggle</button>';
    });

    const confirmed = session.verify((ref, container) => {
      if (ref.id === 'story:card') mountCard(container);
      else container.innerHTML = '<button>Toggle</button>';
    }, ['story:card']);

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.culprit).toBe('story:theme-toggle');
    expect(confirmed[0]!.key).toBe('root-attr:class');
  });

  it('catches a root custom property overwritten by another subject', () => {
    session.run(subject('story:card'), (container) => {
      inject(':root { --pad: 4px }');
      inject('.card { padding-top: var(--pad) }');
      mountCard(container);
    });
    session.run(subject('story:theme'), (container) => {
      document.documentElement.style.setProperty('--pad', '40px');
      container.innerHTML = '<div>theme</div>';
    });

    const confirmed = session.verify((ref, container) => {
      if (ref.id === 'story:card') mountCard(container);
      else container.innerHTML = '<div>theme</div>';
    }, ['story:card']);

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.culprit).toBe('story:theme');
    expect(confirmed[0]!.key).toBe('root-custom:--pad');
  });

  it('reports a subject that is unstable on its own, with no culprit', () => {
    // A hash that moves with nobody else writing anything is not pollution — it
    // is non-determinism inside the subject. Conflating the two would send an
    // agent looking for a leak that does not exist.
    let counter = 0;
    const flaky = (container: HTMLElement): void => {
      container.innerHTML = `<p>render ${(counter += 1)}</p>`;
    };

    session.run(subject('story:flaky'), flaky);
    const confirmed = session.verify((_ref, container) => flaky(container), ['story:flaky']);

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.culprit).toBeUndefined();
    expect(confirmed[0]!.evidence).toMatch(/inside the subject itself/);
    expect(confirmed[0]!.remedy).toMatch(/deterministic/);
  });

  it('records a stray node left in the body', () => {
    // An unmounted portal, a toast that never dismissed, a modal backdrop.
    const run = session.run(subject('story:dialog'), (container) => {
      const orphan = document.createElement('div');
      orphan.className = 'backdrop';
      document.body.appendChild(orphan);
      container.innerHTML = '<button>Open</button>';
    });

    expect(run.writes).toContain('body-residue');
  });
});

// ===========================================================================
// Write detection: the probe has to notice the right things
// ===========================================================================

describe('what counts as a write', () => {
  it('notices a rule rewritten in place, not just a sheet appended', () => {
    // Rule count is unchanged; a count-based fingerprint would miss this entirely,
    // and it is exactly what a CSS-in-JS runtime does when a theme changes.
    const style = document.createElement('style');
    style.textContent = '.card { color: blue }';
    document.head.appendChild(style);

    session.run(subject('story:card'), mountCard);
    const rewrite = session.run(subject('story:rewriter'), (container) => {
      style.textContent = '.card { color: red }';
      container.innerHTML = '<div>x</div>';
    });

    expect([...rewrite.writes].some((key) => key.startsWith('sheet:'))).toBe(true);
  });

  it('does not count the subject`s own output as body residue', () => {
    const run = session.run(subject('story:card'), mountCard);
    expect(run.writes).not.toContain('body-residue');
  });

  it('treats sheet removal as a write', () => {
    const style = document.createElement('style');
    style.textContent = '.card { color: blue }';
    document.head.appendChild(style);

    session.run(subject('story:card'), mountCard);
    const remover = session.run(subject('story:remover'), (container) => {
      style.remove();
      container.innerHTML = '<div>x</div>';
    });

    expect([...remover.writes].some((key) => key.startsWith('sheet:'))).toBe(true);
  });
});

// ===========================================================================
// Read detection: coupling has to be visible before it bites
// ===========================================================================

describe('what counts as a read', () => {
  it('counts a rule that matched but lost the cascade', () => {
    // A losing declaration is one specificity bump from winning. Recording only
    // winners would miss the pollution where another subject's edit flips which
    // rule wins.
    inject('.card-body { color: blue }');
    inject('.card .card-body { color: green }');

    const run = session.run(subject('story:card'), mountCard);
    const sheetReads = [...run.reads].filter((key) => key.startsWith('sheet:'));

    expect(sheetReads.length).toBeGreaterThanOrEqual(2);
  });

  it('counts a custom property the subject resolved through', () => {
    inject(':root { --pad: 4px }');
    inject('.card { padding-top: var(--pad) }');

    const run = session.run(subject('story:card'), mountCard);
    expect(run.reads).toContain('root-custom:--pad');
  });

  it('counts a selector anchored above the subject', () => {
    inject('html.dark .card { color: white }');

    const run = session.run(subject('story:card'), mountCard);
    expect(run.reads).toContain('root-attr:class');
  });

  it('does not count a class on the subject`s own node as root coupling', () => {
    // `.card.dark` is self-describing; `html.dark .card` is not. Conflating them
    // would make every component with a modifier class look coupled to the root.
    inject('.card.dark { color: white }');

    const run = session.run(subject('story:card'), mountCard);
    expect(run.reads).not.toContain('root-attr:class');
  });
});

// ===========================================================================
// Targeted repair
// ===========================================================================

describe('paying only where it is real', () => {
  it('removes a leaked sheet without rebuilding the document', () => {
    // The point of detection is that repair can be surgical. A full rinse costs
    // one teardown per subject; this costs one removal per confirmed leak.
    session.run(subject('story:button'), (container) => {
      inject('.card { padding: 99px }');
      mountButton(container);
    });
    const polluted = session.run(subject('story:card'), mountCard);

    const leak = session.findings().find((f) => f.victim === 'story:card')!;
    session.rinse([leak.key!]);

    const repaired = session.run(subject('story:card'), mountCard);
    expect(repaired.snapshot.renderHash).not.toBe(polluted.snapshot.renderHash);
  });
});
