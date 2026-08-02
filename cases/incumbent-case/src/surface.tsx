/**
 * The subject both arms observe: one invoice panel, eight ways.
 *
 * Every variant is a prop rather than a second copy of the markup, so the two
 * arms cannot be observing different trees — the failure that would make the
 * whole head-to-head a story about which copy drifted.
 *
 * **Four of the edits are required to paint identical pixels**, and that is not a
 * trick played on the camera. Each is the change a developer actually makes:
 * `<h2>` becomes a styled `<div>` because a designer wanted the size somewhere
 * else, a `<button>` becomes a `<div>` because the button was fighting a layout.
 * Both are copied across faithfully, which is exactly why they render the same
 * and exactly why they ship. The style objects are shared between the branches
 * rather than duplicated, so "identical" is a property of the code and not a
 * claim to be re-checked whenever someone edits a padding.
 */

const PALETTE = {
  text: '#17181c',
  muted: '#6b6f7a',
  border: '#e3e5ea',
  accent: '#2d6cdf',
  surface: '#ffffff',
};

export interface Edit {
  readonly labelled: boolean;
  readonly heading: 'h2' | 'div';
  readonly control: 'button' | 'div';
  readonly rows: number;
  readonly space: number;
  readonly indicator: boolean;
  readonly reindented: boolean;
}

const ROWS = [
  { label: 'Design retainer', amount: '€ 2,400.00' },
  { label: 'Implementation', amount: '€ 7,150.00' },
  { label: 'Accessibility audit', amount: '€ 900.00' },
  { label: 'Handover workshop', amount: '€ 450.00' },
];

/**
 * The heading's rendered properties, in one object used by both branches.
 *
 * A `<h2>` carries a UA margin, size and weight; a `<div>` carries none of them.
 * Declaring all three explicitly is what a developer doing this refactor does,
 * and it is what makes the demotion invisible to a camera.
 */
const HEADING_STYLE = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 600,
  lineHeight: '24px',
  color: PALETTE.text,
} as const;

/**
 * The row control's rendered properties, likewise shared.
 *
 * A `<button>` brings its own font, border, background, padding and box-sizing.
 * Every one of them is overridden here, so the `<div>` branch needs no
 * compensating styles and the two are pixel-identical by construction.
 */
const CONTROL_STYLE = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  font: 'inherit',
  fontSize: '13px',
  lineHeight: '16px',
  color: PALETTE.accent,
  background: 'transparent',
  border: `1px solid ${PALETTE.border}`,
  borderRadius: '4px',
  padding: '2px 8px',
  margin: 0,
  cursor: 'pointer',
  textAlign: 'center',
} as const;

function noop(): void {
  /* the handler exists so the devolved control is not obviously inert */
}

function Heading({ as, children }: { as: 'h2' | 'div'; children: string }) {
  // Both branches, one style object. The difference reaching the DOM is the tag
  // name and nothing else, which is the whole scenario.
  return as === 'h2' ? (
    <h2 style={HEADING_STYLE}>{children}</h2>
  ) : (
    <div style={HEADING_STYLE}>{children}</div>
  );
}

function IconButton({ labelled, glyph, action }: { labelled: boolean; glyph: string; action: string }) {
  return (
    <button
      type="button"
      onClick={noop}
      {...(labelled ? { 'aria-label': action } : {})}
      style={{
        ...CONTROL_STYLE,
        width: '28px',
        height: '28px',
        padding: 0,
        fontSize: '15px',
        color: PALETTE.muted,
      }}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/**
 * The unsaved-changes dot, in a slot that keeps its size when the dot is gone.
 *
 * The fixed slot is the point of the scenario rather than a detail of it. If
 * removing the indicator reflowed the toolbar, the diff would be the reflow and
 * a pixel differ would catch it easily — which would make the row a measurement
 * of layout movement instead of a measurement of how small a real regression can
 * be. Nothing moves; the dot is simply not painted.
 */
function Indicator({ shown }: { shown: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
      }}
    >
      {shown ? (
        <span
          title="Unsaved changes"
          style={{
            display: 'block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: PALETTE.accent,
          }}
        />
      ) : null}
    </span>
  );
}

function Toolbar({ labelled, indicator, space }: { labelled: boolean; indicator: boolean; space: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: `${space / 2}px` }}>
      <IconButton labelled={labelled} glyph="⟳" action="Refresh invoice" />
      <IconButton labelled glyph="⤓" action="Download invoice" />
      <span style={{ flex: 1 }} />
      <Indicator shown={indicator} />
    </div>
  );
}

function RowAction({ as, children }: { as: 'button' | 'div'; children: string }) {
  return as === 'button' ? (
    <button type="button" onClick={noop} style={CONTROL_STYLE}>
      {children}
    </button>
  ) : (
    <div onClick={noop} style={CONTROL_STYLE}>
      {children}
    </div>
  );
}

function Row({ label, amount, control }: { label: string; amount: string; control: 'button' | 'div' }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        borderTop: `1px solid ${PALETTE.border}`,
        paddingTop: 'var(--case-space)',
        marginTop: 'var(--case-space)',
      }}
    >
      <span style={{ flex: 1, fontSize: '14px', color: PALETTE.text }}>{label}</span>
      <span style={{ fontSize: '14px', color: PALETTE.muted, fontVariantNumeric: 'tabular-nums' }}>
        {amount}
      </span>
      <RowAction as={control}>Edit</RowAction>
    </div>
  );
}

function Rows({ count, control }: { count: number; control: 'button' | 'div' }) {
  return (
    <div>
      {ROWS.slice(0, count).map((row) => (
        <Row key={row.label} label={row.label} amount={row.amount} control={control} />
      ))}
    </div>
  );
}

/**
 * The note, in the two shapes a formatter produces.
 *
 * `{' '}` is not decoration: it is what a formatter emits when it wraps inline
 * children onto their own lines, and it is the exact shape
 * `examples/todomvc/src/pixel/instability.tsx` measured as `block-whitespace`.
 * Leading and trailing whitespace inside a block collapses away when it is
 * painted, so the two render identically — and the normalizer keeps the space,
 * because telling a block context from an inline one needs a layout engine.
 */
function Note({ reindented }: { reindented: boolean }) {
  const style = { margin: 0, fontSize: '12px', lineHeight: '16px', color: PALETTE.muted } as const;

  return reindented ? (
    <p style={style}>
      {' '}
      <span>Prices exclude VAT.</span> <span>Payable within 30 days.</span>{' '}
    </p>
  ) : (
    <p style={style}>
      <span>Prices exclude VAT.</span> <span>Payable within 30 days.</span>
    </p>
  );
}

function Total({ rows }: { rows: number }) {
  const total = ROWS.slice(0, rows).reduce(
    (sum, row) => sum + Number(row.amount.replace(/[^\d.]/g, '')),
    0,
  );

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 600 }}>
      <span style={{ color: PALETTE.text }}>Total</span>
      <span style={{ color: PALETTE.text, fontVariantNumeric: 'tabular-nums' }}>
        {`€ ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
      </span>
    </div>
  );
}

export function Panel(edit: Edit) {
  return (
    <div
      style={
        {
          '--case-space': `${edit.space}px`,
          boxSizing: 'border-box',
          width: '420px',
          padding: 'calc(var(--case-space) * 1.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--case-space)',
          background: PALETTE.surface,
          border: `1px solid ${PALETTE.border}`,
          borderRadius: '8px',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        } as React.CSSProperties
      }
    >
      <Toolbar labelled={edit.labelled} indicator={edit.indicator} space={edit.space} />
      <Heading as={edit.heading}>Invoice INV-2026-0184</Heading>
      <Rows count={edit.rows} control={edit.control} />
      <Total rows={edit.rows} />
      <Note reindented={edit.reindented} />
    </div>
  );
}
