import { Suspense, use, useEffect, useState } from 'react';

/**
 * A small design system, plus three components that are deliberately unstable.
 *
 * The stable ones exist so the adapter has ordinary subjects to read. The
 * unstable ones exist because a case that only presents well-behaved stories
 * proves the easy half: every visual-regression tool handles a static button.
 * What separates them is what happens when a subject is still moving when the
 * capture arrives, and whether the tool can say *where* rather than capturing
 * again until the problem goes away.
 *
 * `AsyncPanel` is the one that matters most. It settles late and says so, which
 * is the contract a project can actually hold up: the framework knows the story
 * function returned, and only the component knows its work is finished.
 */

const TOKENS = {
  '--case-accent': '#2d6cdf',
  '--case-text': '#17181c',
  '--case-border': '#e3e5ea',
  '--case-radius': '6px',
  '--case-space': '12px',
};

export function Tokens({ children, overrides = {} }) {
  return (
    <div style={{ ...TOKENS, ...overrides, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {children}
    </div>
  );
}

/**
 * The edit, as an edit — selected at build time, never threaded as a prop.
 *
 * `VITE_CASE_MUTATION=wide-button` produces a second Storybook in which `Button`
 * declares different padding, which is what lets a run be scored against a
 * *change* without any file in this repository being modified and restored.
 *
 * Read here rather than passed in, for the reason
 * `examples/todomvc/src/code-mutation.ts` records: a prop change and a source
 * change are different causes with different correct attributions. Threading a
 * switch down as a prop makes every source edit look like a composition change,
 * and it is then rooted at whichever component happens to be the story's entry
 * point — the same logical edit attributed to a different component in every
 * story. `Button`'s props do not move here; its own output does.
 */
const WIDE_BUTTON = import.meta.env?.VITE_CASE_MUTATION === 'wide-button';

export function Button({ children, variant = 'primary' }) {
  return (
    <button
      type="button"
      style={{
        padding: WIDE_BUTTON
          ? 'calc(var(--case-space) * 1.25) calc(var(--case-space) * 2)'
          : 'var(--case-space) calc(var(--case-space) * 1.5)',
        borderRadius: 'var(--case-radius)',
        // A secondary action is still an action: outlined in the accent, so it
        // reads as a button beside a primary one rather than as a caption.
        border: variant === 'primary' ? '1px solid var(--case-border)' : '1px solid var(--case-accent)',
        background: variant === 'primary' ? 'var(--case-accent)' : 'transparent',
        color: variant === 'primary' ? '#fff' : 'var(--case-accent)',
        font: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

export function Stack({ children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--case-space)' }}>{children}</div>;
}

export function Card({ title, children }) {
  return (
    <div
      style={{
        border: '1px solid var(--case-border)',
        borderRadius: 'var(--case-radius)',
        padding: 'calc(var(--case-space) * 1.5)',
        minWidth: 260,
      }}
    >
      <h3 style={{ margin: 0, marginBottom: 'var(--case-space)', color: 'var(--case-text)' }}>{title}</h3>
      <Stack>{children}</Stack>
    </div>
  );
}

/**
 * Never settles. A capture taken at any moment catches a different rotation.
 *
 * Present so the adapter meets an instability whose cause is a declaration on a
 * named component, which is the case where naming the location is possible and
 * a mask would be the wrong fix.
 */
export function Spinner() {
  return (
    <>
      <style>{'@keyframes case-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'}</style>
      <div
        data-testid="spinner"
        style={{
          width: 32,
          height: 32,
          border: '3px solid var(--case-border)',
          borderTopColor: 'var(--case-accent)',
          borderRadius: '50%',
          animation: 'case-spin 900ms linear infinite',
        }}
      />
    </>
  );
}

/** Re-renders on a timer. The instability is content, not style. */
export function Clock() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 50);
    return () => clearInterval(id);
  }, []);

  return <time data-testid="clock">{`elapsed ${tick * 50}ms`}</time>;
}

/**
 * Finishes after the story function has already returned, then says so.
 *
 * The marker is attached only once the deferred work has landed. A tool that
 * captures on the framework's render event sees the skeleton; a tool that waits
 * for the marker sees the subject. Both are reproducible, and only one of them
 * is the component.
 */
/**
 * Closed until something clicks it.
 *
 * Here so a story can have a subject that only exists after its play function
 * has run: the closed state renders a button and nothing else, and the open one
 * renders content a comparison can see. A capture taken before the play function
 * would be of a page that is not what the story is about, and would look
 * entirely correct.
 */
export function Disclosure() {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ minWidth: 260 }}>
      <button type="button" data-testid="reveal" onClick={() => setOpen(true)}>
        Show details
      </button>
      {open ? (
        <div data-testid="revealed" style={{ color: 'var(--case-text)', paddingTop: 8 }}>
          Shipping to Wollongong on Tuesday
        </div>
      ) : null}
    </div>
  );
}

/**
 * The three components below suspend, which is a different problem to `AsyncPanel`.
 *
 * `AsyncPanel` renders a placeholder *itself*, so its own markup can carry the
 * marker that says it is finished. A component that suspends renders nothing at
 * all: what is on screen belongs to a `<Suspense>` boundary somewhere above it,
 * and there is no place left to attach a declaration to. Every readiness
 * mechanism that asks the subject to speak — Storybook's `storyRendered`, a
 * `waitForSelector`, a two-frame quiescence check — is asking a component that
 * does not exist yet.
 *
 * So they are here to be waited on from the outside, by reading the boundary's
 * fiber. See `awaitSuspense` in `@variance-authority/react`.
 */

/** A promise the case owns, so a story suspends for a reason the story states. */
function arriving(value, delayMs) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), delayMs);
  });
}

/**
 * One object, resolved by nobody.
 *
 * The shape of a real outage — a request that was never sent, a query key that
 * never matches, a promise created in a branch that returns early. On a fast
 * machine and on a slow one this renders the same fallback, which is what makes
 * it worth capturing deliberately and dangerous to capture by accident.
 */
const NEVER_ARRIVES = new Promise(() => {});

/** Deliberately still: an animated fallback would be a second, unrelated flake. */
function Skeleton({ label }) {
  return (
    <div
      data-testid="skeleton"
      style={{
        minWidth: 260,
        minHeight: 72,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px dashed var(--case-border)',
        borderRadius: 'var(--case-radius)',
        color: '#767a85',
      }}
    >
      {label}
    </div>
  );
}

function Rows({ source }) {
  const rows = use(source);

  return (
    <div data-testid="suspense-ready" style={{ minWidth: 260 }}>
      <Stack>
        {rows.map((row) => (
          <div key={row} style={{ color: 'var(--case-text)' }}>
            {row}
          </div>
        ))}
      </Stack>
    </div>
  );
}

/**
 * Suspends, then arrives. Nothing about it is declared anywhere.
 *
 * The promise is created in a lazy `useState` so it is one promise per mount:
 * created during render it would be a new object every attempt, and the boundary
 * would never resolve for a reason that has nothing to do with the data.
 */
export function SuspendedRoster({ delayMs = 120 }) {
  const [source] = useState(() => arriving(['Ada', 'Grace', 'Katherine'], delayMs));

  return (
    <Suspense fallback={<Skeleton label="loading roster…" />}>
      <Rows source={source} />
    </Suspense>
  );
}

/**
 * A boundary that does not exist until another boundary resolves.
 *
 * This is the case a single clean reading gets wrong. At the moment the outer
 * promise settles there is exactly one boundary in the tree and it is showing
 * children — settled, by any measure taken right then. React then commits those
 * children, `Invoice` mounts, and the inner `<Suspense>` appears *already
 * showing its fallback*. Anything that captured on the first clean reading
 * photographs "loading lines…".
 */
function Invoice({ source, innerMs }) {
  const title = use(source);
  const [lines] = useState(() => arriving(['Design', 'Build', 'Handover'], innerMs));

  return (
    <div data-testid="waterfall" style={{ minWidth: 260 }}>
      <h3 style={{ margin: 0, marginBottom: 'var(--case-space)', color: 'var(--case-text)' }}>{title}</h3>
      <Suspense fallback={<Skeleton label="loading lines…" />}>
        <Rows source={lines} />
      </Suspense>
    </div>
  );
}

export function SuspendedWaterfall({ outerMs = 80, innerMs = 80 }) {
  const [source] = useState(() => arriving('Invoice #4021', outerMs));

  return (
    <Suspense fallback={<Skeleton label="loading invoice…" />}>
      <Invoice source={source} innerMs={innerMs} />
    </Suspense>
  );
}

function Stalled() {
  use(NEVER_ARRIVES);
  return <div>unreachable</div>;
}

/** Suspends forever. The story is the decision it forces, not the markup. */
export function StalledFeed() {
  return (
    <Suspense fallback={<Skeleton label="loading feed…" />}>
      <Stalled />
    </Suspense>
  );
}

export function AsyncPanel({ delayMs = 120 }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    const id = setTimeout(() => setRows(['Ada', 'Grace', 'Katherine']), delayMs);
    return () => clearTimeout(id);
  }, [delayMs]);

  if (rows === null) {
    return <div style={{ minWidth: 260, minHeight: 96, color: '#767a85' }}>loading…</div>;
  }

  return (
    <div data-testid="case-ready" style={{ minWidth: 260 }}>
      <Stack>
        {rows.map((row) => (
          <div key={row} style={{ color: 'var(--case-text)' }}>
            {row}
          </div>
        ))}
      </Stack>
    </div>
  );
}

/**
 * Writes a rule into the document and never takes it back.
 *
 * The one failure a shared page makes possible and a fresh one cannot. This
 * component renders correctly, settles immediately and would pass any check
 * applied to it — and it leaves behind a rule that belongs to no story. Every
 * subject read after it *in the same page* is read through that rule, so a
 * button in some other story grows and the comparison reports that its pixels
 * moved. Which is true, and is not a regression, and nothing in the image can
 * tell the two apart.
 *
 * Not contrived. A chart library that appends its theme on first use, a modal
 * that injects a scroll lock, a font loader, a tooltip that ships its own
 * positioning rules: all of them do exactly this, all of them are correct in
 * isolation, and all of them are invisible until something reads the stories in
 * a different order.
 *
 * The rule targets a property `Button` does not declare inline, because an
 * inline declaration would win and the leak would be silent — which would make
 * this a component that *looks* dangerous and is not, and prove the opposite of
 * what it is here for.
 */
export function SheetLeak() {
  useEffect(() => {
    const sheet = document.createElement('style');
    sheet.dataset.caseLeak = 'sheet';
    sheet.textContent = '#storybook-root button{letter-spacing:0.35em;text-transform:uppercase}';
    document.head.append(sheet);

    // No cleanup, deliberately. Returning a remover here would make this a
    // well-behaved component and delete the only order dependence in the case —
    // and the whole point is that the author of a component like this believes
    // they wrote the well-behaved version.
  }, []);

  return (
    <span data-testid="case-leak" style={{ color: 'var(--case-text)' }}>
      left a sheet in the document
    </span>
  );
}
