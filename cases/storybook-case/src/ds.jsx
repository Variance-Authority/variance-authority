import { useEffect, useState } from 'react';

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

export function Button({ children, variant = 'primary' }) {
  return (
    <button
      type="button"
      style={{
        padding: 'var(--case-space) calc(var(--case-space) * 1.5)',
        borderRadius: 'var(--case-radius)',
        border: '1px solid var(--case-border)',
        background: variant === 'primary' ? 'var(--case-accent)' : 'transparent',
        color: variant === 'primary' ? '#fff' : 'var(--case-text)',
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
