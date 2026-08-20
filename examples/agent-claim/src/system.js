/**
 * A design system small enough to read whole, held in two revisions at once.
 *
 * Every component takes the revision it is being rendered under, so one process
 * can produce *both* sides of a comparison — which is what ephemeral retention
 * is (ADR-0011) and what makes this example runnable with no store, no baseline
 * directory and nothing committed.
 *
 * The edit under test is the `after` column of {@link PALETTE}. `Card` has no
 * entry in it, on purpose: this file is the branch where somebody meant to
 * tighten the card and the change never landed, and that is the arm of the
 * adjudication nothing else in the category reports.
 */

const PALETTE = {
  before: { Button: '#1d4ed8', Badge: '#b45309', Avatar: '#0f766e' },
  after: { Button: '#7c3aed', Badge: '#be123c', Avatar: '#7e22ce' },
};

function element(tag, component, style, text) {
  const node = document.createElement(tag);
  node.setAttribute('data-component', component);
  node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function Button(revision) {
  return element(
    'button',
    'Button',
    'display:block;width:96px;height:32px;border:0;border-radius:6px;' +
      `font:600 13px/32px Arial;color:#ffffff;background:${PALETTE[revision].Button}`,
    'Save',
  );
}

export function Badge(revision) {
  return element(
    'span',
    'Badge',
    'display:block;width:64px;height:20px;border-radius:10px;' +
      `font:600 11px/20px Arial;color:#ffffff;text-align:center;background:${PALETTE[revision].Badge}`,
    'New',
  );
}

export function Avatar(revision) {
  return element(
    'span',
    'Avatar',
    'display:block;width:32px;height:32px;border-radius:16px;' +
      `font:600 13px/32px Arial;color:#ffffff;text-align:center;background:${PALETTE[revision].Avatar}`,
    'MK',
  );
}

/** Unchanged between revisions. The claim about it is the one that did not land. */
export function Card(revision, children) {
  const node = element(
    'section',
    'Card',
    'display:flex;gap:12px;align-items:center;width:224px;padding:16px;' +
      'box-sizing:border-box;border-radius:8px;background:#f1f5f9',
  );
  for (const child of children) node.append(child(revision));
  return node;
}

/**
 * What this suite watches, by subject id.
 *
 * `Tooltip` is not here and is not defined above. A claim about it is a claim
 * this run has no standing to judge, which is a different answer from a claim
 * that failed — and telling those two apart is the point of the example.
 */
export const SUBJECTS = {
  'card/summary': (revision) => Card(revision, [Avatar, Button]),
  'card/compact': (revision) => Card(revision, [Button]),
  'badge/standalone': (revision) => Badge(revision),
};
