import type { ReactNode } from 'react';

/**
 * The design system: seven components, each a thin wrapper over a token-driven
 * class.
 *
 * Kept deliberately plain. The interesting behaviour in this example is not in
 * the components — it is in what happens to the *pages* built from them when a
 * token underneath moves, and a component that did anything clever would blur
 * that.
 *
 * Every component sets `displayName` implicitly through its function name, which
 * is what the fiber walk reads to produce owner chains. A component defined as
 * an anonymous arrow assigned to a `const` would still resolve — the binding name
 * becomes the function name — but a component wrapped in `memo()` without a
 * `displayName` would resolve to its inner function, which is why none of them
 * are wrapped here.
 */

export interface StackProps {
  readonly direction?: 'row' | 'column';
  readonly gap?: 1 | 2 | 3;
  readonly children: ReactNode;
}

export function Stack({ direction = 'column', gap = 2, children }: StackProps): ReactNode {
  return (
    <div className={`va-stack ${direction === 'row' ? 'va-stack--row' : ''} va-stack--gap-${gap}`}>
      {children}
    </div>
  );
}

export interface TextProps {
  readonly size?: 'sm' | 'md' | 'lg';
  readonly tone?: 'default' | 'muted' | 'done';
  readonly as?: 'p' | 'span' | 'h1';
  readonly children: ReactNode;
}

export function Text({ size = 'md', tone = 'default', as = 'span', children }: TextProps): ReactNode {
  const className = [
    'va-text',
    size !== 'md' ? `va-text--${size}` : '',
    tone !== 'default' ? `va-text--${tone}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (as === 'h1') return <h1 className={className}>{children}</h1>;
  if (as === 'p') return <p className={className}>{children}</p>;
  return <span className={className}>{children}</span>;
}

export interface ButtonProps {
  readonly variant?: 'default' | 'primary' | 'danger';
  readonly label: string;
  readonly onPress?: () => void;
}

export function Button({ variant = 'default', label, onPress }: ButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={`va-button ${variant !== 'default' ? `va-button--${variant}` : ''}`}
      onClick={onPress}
    >
      {label}
    </button>
  );
}

export interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
}

export function TextField({ id, label, value, placeholder }: TextFieldProps): ReactNode {
  return (
    <>
      <label className="va-text va-text--sm va-text--muted" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="va-field" type="text" value={value} placeholder={placeholder} readOnly />
    </>
  );
}

export interface ToggleProps {
  readonly id: string;
  readonly checked: boolean;
  readonly label: string;
  /**
   * Render as a bare `<div>` instead of a checkbox.
   *
   * This exists to be *wrong*. It is pixel-identical to the correct rendering
   * and semantically broken: no role, no checked state, no label association,
   * unreachable by keyboard. It is the mutation the head-to-head comparison
   * turns on, because a tool whose only signal is the rendered image cannot see
   * it at all.
   */
  readonly asDiv?: boolean;
}

export function Toggle({ id, checked, label, asDiv = false }: ToggleProps): ReactNode {
  const className = `va-toggle ${checked ? 'va-toggle--on' : ''}`;

  if (asDiv) return <div className={className} />;

  return <input id={id} className={className} type="checkbox" checked={checked} aria-label={label} readOnly />;
}

export interface ChipProps {
  readonly label: string;
  readonly selected?: boolean;
}

export function Chip({ label, selected = false }: ChipProps): ReactNode {
  return (
    <button
      type="button"
      className={`va-chip ${selected ? 'va-chip--selected' : ''}`}
      aria-pressed={selected}
    >
      {label}
    </button>
  );
}

export interface CardProps {
  readonly children: ReactNode;
}

export function Card({ children }: CardProps): ReactNode {
  return <div className="va-card">{children}</div>;
}
