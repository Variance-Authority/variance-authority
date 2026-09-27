/**
 * What Eyes saw, said as one line to a story being recorded in the same realm.
 *
 * A story is the order one case visited the code in, and a visit says where the
 * case was, never with what. The attention Eyes keeps is the other half: which
 * query the test asked with which arguments, what it found, which event fired
 * on which element, which components committed. Said beside the visits, a
 * route reads `getByRole("button", {"name":"Save"}) → button "Save" in
 * SaveBar` at the step the query ran, and a reader comparing two runs sees the
 * argument that changed rather than inferring it.
 *
 * The recorder listens on a symbol it installs only when a story was asked for,
 * so outside one the cost of a record is one property read. Nothing a listener
 * does reaches the log: a channel that throws is swallowed here.
 */

import type { ArgumentSnapshot, AttentionDraft, LocatorStep, TargetSnapshot } from './access.js';

/** Where a story recorder in this realm listens; mirrors `NOTE` in sense's `story-tap.cts`. */
const NOTE = Symbol.for('variance-authority.story.note');

type Channel = (text: string) => void;

function argument(value: ArgumentSnapshot): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(argument).join(', ')}]`;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'undefined') return 'undefined';
  if (kind === 'regexp') {
    const regexp = value as { source: string; flags: string };
    return `/${regexp.source}/${regexp.flags}`;
  }
  if (kind === 'bigint' || kind === 'symbol') return (value as { value: string }).value;
  if (kind === 'function') return `ƒ ${(value as { name: string }).name}`;
  if (kind === 'unavailable') return `‹${(value as { description: string }).description}›`;
  const entries = Object.entries(value as Record<string, ArgumentSnapshot>);
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${argument(entry)}`).join(', ')}}`;
}

const call = (name: string, values: readonly ArgumentSnapshot[]): string => `${name}(${values.map(argument).join(', ')})`;

const chain = (steps: readonly LocatorStep[]): string => steps.map((step) => call(step.member, step.arguments)).join('.');

/** An element as a person names it: its tag, its accessible name, and the component that drew it. */
function target(node: TargetSnapshot): string {
  const tag = node.nodeName.toLowerCase();
  const id = node.id === undefined ? '' : `#${node.id}`;
  const label = node.name ?? node.ariaLabel;
  const named = label === undefined ? '' : ` ${JSON.stringify(label)}`;
  const owner = node.provenance.status === 'resolved' ? node.provenance.provenance.owners[0]?.name : undefined;
  return `${tag}${id}${named}${owner === undefined ? '' : ` in ${owner}`}`;
}

const found = (targets: readonly TargetSnapshot[]): string =>
  targets.length === 0 ? 'nothing' : targets.length === 1 ? target(targets[0]!) : `${targets.length}: ${targets.map(target).join(', ')}`;

/** One attention entry as the line a route shows beside the step it was recorded at. */
export function noteOf(draft: AttentionDraft): string {
  switch (draft.kind) {
    case 'eyes-phase':
      return `eyes ${draft.phase}`;
    case 'rtl-query': {
      const asked = `eyes ${call(draft.query, draft.arguments)}`;
      if (draft.outcome === 'resolved') return `${asked} → ${found(draft.targets)}`;
      if (draft.outcome === 'absent') return `${asked} → absent`;
      return `${asked} → threw ${draft.error}`;
    }
    case 'playwright-locator': {
      if (draft.operation === 'planned') return `eyes ${chain(draft.locator)}`;
      const asked = `eyes ${chain(draft.locator)}.${draft.member}`;
      if (draft.outcome === 'threw') return `${asked} → threw ${draft.error}`;
      return draft.after === undefined ? asked : `${asked} → ${found(draft.after)}`;
    }
    case 'document-event':
      return `eyes ${draft.event}${draft.trusted ? '' : ' (synthetic)'} on ${target(draft.target)}`;
    case 'react-commit':
      return `eyes commit ${draft.commit.components.length === 0 ? '(host only)' : draft.commit.components.join(', ')}`;
    case 'react-tap-refused':
      return `eyes react tap refused: ${draft.reason}`;
  }
}

/** Say `draft` to a story recorder in this realm, when one is listening. */
export function sayToStory(draft: AttentionDraft): void {
  const channel = (globalThis as { [NOTE]?: Channel })[NOTE];
  if (typeof channel !== 'function') return;
  try {
    channel(noteOf(draft));
  } catch {
    // A recorder's bug may not become a bug in the test it records.
  }
}
