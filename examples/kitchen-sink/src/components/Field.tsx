/**
 * The structural-aliasing fixture, and the sharpest one in the corpus.
 *
 * `<label for>` → `<input id>` → `aria-describedby` → help text is three id
 * references over two generated values. Under ADR-0003 those values are erased and
 * the *relationships* survive as `#a0`, `#a1`, which makes two changes that look
 * identical in the raw DOM diverge completely:
 *
 * - every id renumbered (`useId` counter shifted): all three references move
 *   together, aliasing maps them onto the same shape → **no hash change**;
 * - `htmlFor` pointed somewhere else: one reference now dangles outside the
 *   subtree and normalizes to `#extern:n` → **`geometry` change**, and correctly
 *   so, because a screen reader user just lost the field's label.
 *
 * Masking both to a constant, which is what spec §4.2 originally said, cannot tell
 * those apart, and would report the accessibility regression as `unchanged`. This
 * component exists to make that distinction measurable rather than argued.
 */

import { useId } from 'react';

export interface FieldProps {
  readonly label: string;
  readonly help: string;
  readonly value: string;
  /** Points `htmlFor` at an id that exists nowhere, breaking the association while
   * leaving the DOM shape, the text, and every style byte-identical. */
  readonly breakAssociation?: boolean | undefined;
  /** Adds a second `aria-describedby` target. Node insertion + reference-list
   * growth in one move: `geometry`. */
  readonly withError?: boolean | undefined;
}

export function Field({ label, help, value, breakAssociation, withError }: FieldProps) {
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();

  const describedBy = withError ? `${helpId} ${errorId}` : helpId;

  return (
    <div className="ks-field">
      <label className="ks-field__label" htmlFor={breakAssociation ? `${inputId}-detached` : inputId}>
        {label}
      </label>
      <input
        className="ks-field__input"
        id={inputId}
        type="text"
        readOnly
        value={value}
        aria-describedby={describedBy}
      />
      <p className="ks-field__help" id={helpId}>
        {help}
      </p>
      {withError ? (
        <p className="ks-field__help ks-field__help--error" id={errorId}>
          This value is not accepted.
        </p>
      ) : null}
    </div>
  );
}

Field.displayName = 'Field';
