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
  readonly locale: Locale;
  /** The panel's own width. The same component lives in a page and in a sidebar. */
  readonly width: number;
  readonly labelled: boolean;
  readonly heading: 'h2' | 'div';
  readonly control: 'button' | 'div';
  readonly rows: number;
  readonly space: number;
  readonly indicator: boolean;
  readonly reindented: boolean;
}

export type Locale = 'en' | 'de';

/**
 * The panel's strings, in two languages.
 *
 * A message catalogue rather than a second copy of the markup, for the same
 * reason every other variant here is a prop: two copies drift, and the whole
 * point is that only the *strings* differ. `en` is byte-identical to what the
 * markup carried before this existed, so no recorded baseline moves.
 *
 * The German is real, not padded to make a point. `Zugänglichkeitsüberprüfung`
 * is a word, and it is unbreakable — which is why the most ordinary i18n layout
 * failure there is happens with ordinary German nouns: a flex item cannot shrink
 * below its longest word, so the row grows past the panel that contains it.
 *
 * `Invoice INV-2026-0184` is deliberately left with its identifier intact. It is
 * the false-alarm case for the `untranslated` rule — `INV-2026-0184` carries
 * letters, so a rule looking for "text that did not change" has something to say
 * about a string nobody should translate. Keeping it here means the measurement
 * reports its own false alarm rather than being run on strings chosen to avoid
 * one.
 */
const MESSAGES: Readonly<Record<Locale, {
  readonly heading: string;
  readonly total: string;
  readonly edit: string;
  readonly refresh: string;
  readonly download: string;
  readonly unsaved: string;
  readonly vat: string;
  readonly terms: string;
  readonly rows: readonly string[];
}>> = {
  en: {
    heading: 'Invoice INV-2026-0184',
    total: 'Total',
    edit: 'Edit',
    refresh: 'Refresh invoice',
    download: 'Download invoice',
    unsaved: 'Unsaved changes',
    vat: 'Prices exclude VAT.',
    terms: 'Payable within 30 days.',
    rows: ['Design retainer', 'Implementation', 'Accessibility audit', 'Handover workshop'],
  },
  de: {
    heading: 'Rechnung INV-2026-0184',
    total: 'Gesamt',
    edit: 'Bearbeiten',
    refresh: 'Rechnung aktualisieren',
    download: 'Rechnung herunterladen',
    // Left in English on purpose: one missing translation, so the measurement
    // has something true to find rather than only its own false alarm.
    unsaved: 'Unsaved changes',
    vat: 'Preise verstehen sich zuzüglich Mehrwertsteuer.',
    terms: 'Zahlbar innerhalb von 30 Tagen.',
    rows: [
      'Gestaltungspauschale',
      'Umsetzung',
      'Zugänglichkeitsüberprüfung',
      'Übergabe-Workshop',
    ],
  },
};

const AMOUNTS = ['€ 2,400.00', '€ 7,150.00', '€ 900.00', '€ 450.00'];

function rowsFor(locale: Locale): readonly { label: string; amount: string }[] {
  return MESSAGES[locale].rows.map((label, index) => ({ label, amount: AMOUNTS[index]! }));
}

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
function Indicator({ shown, title }: { shown: boolean; title: string }) {
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
          title={title}
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

function Toolbar({
  labelled,
  indicator,
  space,
  locale,
}: { labelled: boolean; indicator: boolean; space: number; locale: Locale }) {
  const messages = MESSAGES[locale];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: `${space / 2}px` }}>
      <IconButton labelled={labelled} glyph="⟳" action={messages.refresh} />
      <IconButton labelled glyph="⤓" action={messages.download} />
      <span style={{ flex: 1 }} />
      <Indicator shown={indicator} title={messages.unsaved} />
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

function Row({
  label,
  amount,
  control,
  action,
}: { label: string; amount: string; control: 'button' | 'div'; action: string }) {
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
      <RowAction as={control}>{action}</RowAction>
    </div>
  );
}

function Rows({
  count,
  control,
  locale,
}: { count: number; control: 'button' | 'div'; locale: Locale }) {
  return (
    <div>
      {rowsFor(locale)
        .slice(0, count)
        .map((row) => (
          <Row
            key={row.label}
            label={row.label}
            amount={row.amount}
            control={control}
            action={MESSAGES[locale].edit}
          />
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
function Note({ reindented, locale }: { reindented: boolean; locale: Locale }) {
  const style = { margin: 0, fontSize: '12px', lineHeight: '16px', color: PALETTE.muted } as const;
  const { vat, terms } = MESSAGES[locale];

  return reindented ? (
    <p style={style}>
      {' '}
      <span>{vat}</span> <span>{terms}</span>{' '}
    </p>
  ) : (
    <p style={style}>
      <span>{vat}</span> <span>{terms}</span>
    </p>
  );
}

function Total({ rows, locale }: { rows: number; locale: Locale }) {
  const total = rowsFor(locale).slice(0, rows).reduce(
    (sum, row) => sum + Number(row.amount.replace(/[^\d.]/g, '')),
    0,
  );

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 600 }}>
      <span style={{ color: PALETTE.text }}>{MESSAGES[locale].total}</span>
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
          width: `${edit.width}px`,
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
      <Toolbar
        labelled={edit.labelled}
        indicator={edit.indicator}
        space={edit.space}
        locale={edit.locale}
      />
      <Heading as={edit.heading}>{MESSAGES[edit.locale].heading}</Heading>
      <Rows count={edit.rows} control={edit.control} locale={edit.locale} />
      <Total rows={edit.rows} locale={edit.locale} />
      <Note reindented={edit.reindented} locale={edit.locale} />
    </div>
  );
}
